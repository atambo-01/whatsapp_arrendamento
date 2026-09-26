package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"

	_ "modernc.org/sqlite"
)

//go:embed index.html
var indexFS embed.FS

var db *sql.DB

type WacliMessage struct {
	ChatJID     string `json:"ChatJID"`
	ChatName    string `json:"ChatName"`
	MsgID       string `json:"MsgID"`
	SenderJID   string `json:"SenderJID"`
	SenderName  string `json:"SenderName"`
	Timestamp   string `json:"Timestamp"`
	FromMe      bool   `json:"FromMe"`
	Text        string `json:"Text"`
	DisplayText string `json:"DisplayText"`
}

type WacliResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Messages []WacliMessage `json:"messages"`
	} `json:"data"`
}

var searchKeywords = []string{"arrendar", "arrenda", "aluguer", "alugar", "renda", "plafond", "vende"}

func main() {
	var err error
	db, err = sql.Open("sqlite", "listings.db")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if err := initDB(); err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/listings", handleListings)
	http.HandleFunc("/api/refresh", handleRefresh)
	http.HandleFunc("/api/refresh/stream", handleRefreshStream)

	log.Println("Server running at http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func initDB() error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS listings (
			msg_id TEXT PRIMARY KEY,
			chat_name TEXT,
			chat_jid TEXT,
			timestamp TEXT,
			sender TEXT,
			sender_jid TEXT,
			title TEXT,
			typology TEXT,
			price INTEGER,
			price_text TEXT,
			location TEXT,
			phone TEXT,
			raw_text TEXT,
			category TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_typology ON listings(typology);
		CREATE INDEX IF NOT EXISTS idx_location ON listings(location);
		CREATE INDEX IF NOT EXISTS idx_price ON listings(price);
		CREATE INDEX IF NOT EXISTS idx_timestamp ON listings(timestamp);
		CREATE INDEX IF NOT EXISTS idx_category ON listings(category);
	`)
	return err
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	data, _ := indexFS.ReadFile("index.html")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

func handleListings(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	typology := q.Get("typology")
	location := q.Get("location")
	minPrice := q.Get("min_price")
	maxPrice := q.Get("max_price")
	search := q.Get("q")
	category := q.Get("category")
	sortCol := q.Get("sort_col")
	sortDir := q.Get("sort_dir")

	if category == "" {
		category = "rental"
	}
	if sortCol == "" {
		sortCol = "timestamp"
	}
	if sortDir == "" {
		sortDir = "desc"
	}

	allowedCols := map[string]bool{
		"title": true, "typology": true, "price": true,
		"location": true, "phone": true, "timestamp": true, "chat_name": true,
	}
	if !allowedCols[sortCol] {
		sortCol = "timestamp"
	}
	if sortDir != "asc" && sortDir != "desc" {
		sortDir = "desc"
	}

	query := "SELECT msg_id, chat_name, chat_jid, timestamp, sender, sender_jid, title, typology, price, price_text, location, phone, raw_text, category FROM listings WHERE category = ?"
	args := []interface{}{category}

	if typology != "" {
		query += " AND typology = ?"
		args = append(args, typology)
	}
	if location != "" {
		query += " AND location = ?"
		args = append(args, location)
	}
	if minPrice != "" {
		query += " AND price >= ?"
		args = append(args, minPrice)
	}
	if maxPrice != "" {
		query += " AND price <= ?"
		args = append(args, maxPrice)
	}
	if search != "" {
		query += " AND (raw_text LIKE ? OR title LIKE ?)"
		s := "%" + search + "%"
		args = append(args, s, s)
	}

	query += fmt.Sprintf(" ORDER BY %s %s NULLS LAST, timestamp DESC LIMIT 500", sortCol, sortDir)

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type Row struct {
		MsgID     string `json:"msg_id"`
		ChatName  string `json:"chat_name"`
		ChatJID   string `json:"chat_jid"`
		Timestamp string `json:"timestamp"`
		Sender    string `json:"sender"`
		SenderJID string `json:"sender_jid"`
		Title     string `json:"title"`
		Typology  string `json:"typology"`
		Price     int    `json:"price"`
		PriceText string `json:"price_text"`
		Location  string `json:"location"`
		Phone     string `json:"phone"`
		RawText   string `json:"raw_text"`
		Category  string `json:"category"`
	}

	var out []Row
	for rows.Next() {
		var r Row
		rows.Scan(&r.MsgID, &r.ChatName, &r.ChatJID, &r.Timestamp, &r.Sender, &r.SenderJID, &r.Title, &r.Typology, &r.Price, &r.PriceText, &r.Location, &r.Phone, &r.RawText, &r.Category)
		out = append(out, r)
	}
	if out == nil {
		out = []Row{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

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
			(msg_id, chat_name, chat_jid, timestamp, sender, sender_jid, title, typology, price, price_text, location, phone, raw_text, category)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, l.MsgID, l.ChatName, l.ChatJID, l.Timestamp, l.Sender, l.SenderJID, l.Title, l.Typology, l.Price, l.PriceText, l.Location, l.Phone, l.RawText, l.Category)
		if err == nil {
			inserted++
		}
	}
	return inserted, len(resp.Data.Messages), counts
}

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
	json.NewEncoder(w).Encode(map[string]interface{}{
		"inserted":     total,
		"total_unique": len(seen),
		"counts":       allCounts,
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