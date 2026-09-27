package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
)

// refreshOnce runs one keyword search against wacli-pro, parses any messages
// it finds, and inserts them into the DB. `seen` dedupes across keywords
// within a single refresh run. Returns the number of newly inserted rows,
// the total number of messages wacli returned, and a per-category tally.
func refreshOnce(kw string, seen map[string]bool) (inserted int, seenCount int, counts map[string]int) {
	counts = map[string]int{"rental": 0, "seeker": 0, "sale": 0, "noise": 0}

	cmd := exec.Command("wacli-pro", "messages", "search", kw, "--json", "--limit", "500")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("wacli error for %q: %v", kw, err)
		return 0, 0, counts
	}
	var resp WacliResponse
	if err := json.Unmarshal(output, &resp); err != nil {
		log.Printf("json error for %q: %v", kw, err)
		return 0, 0, counts
	}
	for _, m := range resp.Data.Messages {
		if seen[m.MsgID] {
			continue
		}
		seen[m.MsgID] = true

		l := ParseListing(m.MsgID, m.ChatName, m.ChatJID, m.Timestamp, m.SenderName, m.SenderJID, m.Text, m.DisplayText)
		counts[l.Category]++

		_, err := db.Exec(`
			INSERT OR REPLACE INTO listings
			(msg_id, chat_name, chat_jid, timestamp, sender, sender_jid, title, typology, price, price_text, location, location_raw, phone, raw_text, category)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, l.MsgID, l.ChatName, l.ChatJID, l.Timestamp, l.Sender, l.SenderJID, l.Title, l.Typology, l.Price, l.PriceText, l.Location, l.LocationRaw, l.Phone, l.RawText, l.Category)
		if err == nil {
			inserted++
		}
	}
	return inserted, len(resp.Data.Messages), counts
}

// handleRefresh runs all search keywords synchronously and returns a summary.
func handleRefresh(w http.ResponseWriter, r *http.Request) {
	total := 0
	seen := map[string]bool{}
	allCounts := map[string]int{"rental": 0, "seeker": 0, "sale": 0, "noise": 0}
	for _, kw := range searchKeywords {
		ins, _, counts := refreshOnce(kw, seen)
		total += ins
		for k, v := range counts {
			allCounts[k] += v
		}
	}
	log.Printf("refresh done: inserted=%d, unique=%d, counts=%v", total, len(seen), allCounts)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"inserted":     total,
		"total_unique": len(seen),
		"counts":       allCounts,
	})
}

// handleRefreshStream is the SSE variant used by the browser. It emits a
// "start", then "step" / "step_done" for each keyword, then "done".
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

	totalKeywords := len(searchKeywords)
	totalInserted := 0
	seen := map[string]bool{}
	allCounts := map[string]int{"rental": 0, "seeker": 0, "sale": 0, "noise": 0}

	send := func(payload map[string]interface{}) {
		b, _ := json.Marshal(payload)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	send(map[string]interface{}{
		"type": "start", "total": totalKeywords,
		"message": "starting refresh",
	})

	for i, kw := range searchKeywords {
		send(map[string]interface{}{
			"type": "step", "index": i, "total": totalKeywords,
			"keyword": kw, "inserted": totalInserted, "seen": len(seen),
			"counts": allCounts,
			"message": fmt.Sprintf("searching %q", kw),
		})
		inserted, _, counts := refreshOnce(kw, seen)
		totalInserted += inserted
		for k, v := range counts {
			allCounts[k] += v
		}
		send(map[string]interface{}{
			"type": "step_done", "index": i, "total": totalKeywords,
			"keyword": kw, "inserted": totalInserted, "seen": len(seen),
			"counts": allCounts,
			"message": fmt.Sprintf("finished %q", kw),
		})
	}

	send(map[string]interface{}{
		"type": "done",
		"inserted": totalInserted, "total_unique": len(seen),
		"counts": allCounts,
		"message": "refresh complete",
	})
}