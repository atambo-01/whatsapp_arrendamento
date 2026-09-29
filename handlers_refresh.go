package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"time"
)

// getLastParsedTs returns the highest message timestamp we've already parsed.
func getLastParsedTs() int64 {
	var ts int64
	err := db.QueryRow(`SELECT last_msg_ts FROM sync_state WHERE id = 1`).Scan(&ts)
	if err != nil {
		return 0
	}
	return ts
}

func setLastParsedTs(ts int64, msgID string) {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec(`
		UPDATE sync_state
		SET last_msg_ts = ?, last_msg_id = ?, updated_at = ?
		WHERE id = 1`, ts, msgID, now)
	if err != nil {
		log.Printf("setLastParsedTs: %v", err)
	}
}

func parseWacliTs(s string) int64 {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04:05Z", s)
		if err != nil {
			return 0
		}
	}
	return t.Unix()
}

// isGroupChat returns true only for group JIDs (@g.us).
// Filters out DMs (@s.whatsapp.net), status (@broadcast), and @lid DMs.
func isGroupChat(jid string) bool {
	return len(jid) > 5 && jid[len(jid)-5:] == "@g.us"
}

func fetchMessages(afterTs int64) ([]WacliMessage, error) {
	args := []string{"messages", "list",
		"--json", "--limit", "100000", "--names"}
	if afterTs > 0 {
		after := time.Unix(afterTs, 0).UTC().Format(time.RFC3339)
		args = append(args, "--after", after)
	}

	cmd := exec.Command("wacli-pro", args...)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("wacli-pro: %w", err)
	}
	var resp WacliResponse
	if err := json.Unmarshal(output, &resp); err != nil {
		return nil, fmt.Errorf("json: %w", err)
	}
	return resp.Data.Messages, nil
}

func refreshOnce(full bool) (inserted int, seen int, counts map[string]int) {
	counts = map[string]int{"rental": 0, "seeker": 0, "sale": 0, "noise": 0}

	var afterTs int64
	if !full {
		afterTs = getLastParsedTs()
	}

	msgs, err := fetchMessages(afterTs)
	if err != nil {
		log.Printf("fetchMessages: %v", err)
		return 0, 0, counts
	}

	// Only process group chats — skip DMs and status broadcasts.
	filtered := msgs[:0]
	for _, m := range msgs {
		if isGroupChat(m.ChatJID) {
			filtered = append(filtered, m)
		}
	}
	msgs = filtered
	seen = len(msgs)

	tx, err := db.Begin()
	if err != nil {
		log.Printf("begin tx: %v", err)
		return 0, 0, counts
	}
	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO listings
		(msg_id, chat_name, chat_jid, timestamp, sender, sender_jid,
		 title, typology, price, price_text, location, location_raw,
		 phone, raw_text, category)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		log.Printf("prepare: %v", err)
		tx.Rollback()
		return 0, 0, counts
	}
	defer stmt.Close()

	var maxTs int64
	var maxMsgID string

	for _, m := range msgs {
		l := ParseListing(m.MsgID, m.ChatName, m.ChatJID, m.Timestamp,
			m.SenderName, m.SenderJID, m.Text, m.DisplayText)
		counts[l.Category]++

		ts := parseWacliTs(m.Timestamp)
		if ts > maxTs {
			maxTs = ts
			maxMsgID = m.MsgID
		}

		_, err := stmt.Exec(l.MsgID, l.ChatName, l.ChatJID, l.Timestamp,
			l.Sender, l.SenderJID, l.Title, l.Typology, l.Price, l.PriceText,
			l.Location, l.LocationRaw, l.Phone, l.RawText, l.Category)
		if err == nil {
			inserted++
		} else {
			log.Printf("insert %s: %v", l.MsgID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("commit: %v", err)
	}

	if maxTs > 0 {
		setLastParsedTs(maxTs, maxMsgID)
	}

	return inserted, seen, counts
}

func handleRefresh(w http.ResponseWriter, r *http.Request) {
	full := r.URL.Query().Get("full") == "1"

	start := time.Now()
	inserted, seen, counts := refreshOnce(full)
	elapsed := time.Since(start)

	log.Printf("refresh done: full=%v inserted=%d seen=%d counts=%v elapsed=%s",
		full, inserted, seen, counts, elapsed)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"inserted":    inserted,
		"seen":        seen,
		"counts":      counts,
		"full":        full,
		"last_msg_ts": getLastParsedTs(),
		"elapsed_ms":  elapsed.Milliseconds(),
	})
}

func handleRefreshStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", 500)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	full := r.URL.Query().Get("full") == "1"

	send := func(payload map[string]interface{}) {
		b, _ := json.Marshal(payload)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	startMsg := "incremental refresh"
	if full {
		startMsg = "full reparse"
	}
	send(map[string]interface{}{
		"type": "start", "total": 1, "message": startMsg,
	})

	inserted, seen, counts := refreshOnce(full)

	send(map[string]interface{}{
		"type": "done",
		"inserted": inserted, "total_unique": seen,
		"counts": counts,
		"message": fmt.Sprintf("done — %d new, %d seen", inserted, seen),
	})
}

var _ = strconv.Atoi