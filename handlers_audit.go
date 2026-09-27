package main

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// handleParseAudit re-runs the parser against every stored raw_text and
// reports rows where the current parser disagrees with the category stored
// at insert time. Used to find misclassification bugs.
//
// With the seeded dev DB the stored category is ground truth, so any mismatch
// is a real parser error. Against the real DB the stored category is whatever
// the parser originally decided, so mismatches mean "the parser's opinion of
// this message has changed since it was first stored" — still useful.
//
// Query params:
//   category=<rental|seeker|sale|noise>  — filter by stored category
//   limit=<N>                            — cap rows scanned (default 5000)
func handleParseAudit(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	if category == "" {
		category = "rental"
	}
	limit := 5000
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}

	rows, err := db.Query(`
		SELECT msg_id, chat_name, chat_jid, timestamp, sender, sender_jid,
		       title, typology, price, price_text, location, location_raw,
		       phone, raw_text, category
		FROM listings WHERE category = ? LIMIT ?`, category, limit)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type Audit struct {
		MsgID    string `json:"msg_id"`
		Stored   string `json:"stored"`
		Reparsed string `json:"reparsed"`
		RawText  string `json:"raw_text"`
	}

	var mismatches []Audit
	var total int

	for rows.Next() {
		var (
			msgID, chatName, chatJID, timestamp, sender, senderJID string
			title, typology, priceText, location, locationRaw      string
			phone, rawText, stored                                 string
			price                                                  int
		)
		if err := rows.Scan(&msgID, &chatName, &chatJID, &timestamp, &sender, &senderJID,
			&title, &typology, &price, &priceText, &location, &locationRaw,
			&phone, &rawText, &stored); err != nil {
			continue
		}
		total++

		reparsed := ParseListing(msgID, chatName, chatJID, timestamp, sender,
			senderJID, rawText, "").Category

		if reparsed != stored {
			mismatches = append(mismatches, Audit{
				MsgID:    msgID,
				Stored:   stored,
				Reparsed: reparsed,
				RawText:  rawText,
			})
		}
	}

	rate := 0.0
	if total > 0 {
		rate = float64(len(mismatches)) / float64(total)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"category":   category,
		"total":      total,
		"mismatches": len(mismatches),
		"rate":       rate,
		"samples":    mismatches,
	})
}