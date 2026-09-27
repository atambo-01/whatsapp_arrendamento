package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"

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

type WacliSearchResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Messages []WacliMessage `json:"messages"`
	} `json:"data"`
}

type WacliResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Messages []WacliMessage `json:"messages"`
	} `json:"data"`
}

var searchKeywords = []string{"arrendar", "arrenda", "aluguer", "alugar", "renda", "plafond", "vende"}

// parentLocation rolls up numbered variants (Zango 1..5, Golf 1..2, Camama 1..4, ...)
// onto a base location that exists in coords.go, so the proximity view doesn't
// silently drop listings whose exact neighborhood isn't geocoded.
var parentLocation = map[string]string{
	"Zango 0": "Zango", "Zango 1": "Zango", "Zango 2": "Zango",
	"Zango 3": "Zango", "Zango 4": "Zango", "Zango 5": "Zango",
	"Golf 1":  "Golf 2", "Golfe 1": "Golf 2", "Golfo 2": "Golf 2", "Golfe 2": "Golf 2",
	"Camama 1": "Camama", "Camama 2": "Camama",
	"Camama 3": "Camama", "Camama 4": "Camama",
	"Kilamba Kiaxi":   "Kilamba",
	"Ilha do Cabo":    "Ilha de Luanda",
	"Futungo de Belas": "Futungo",
	"Lar do Patriota": "Patriota",
	"Mártires do Kifangondo": "Samba",
	"Mártires de Kifangondo": "Samba",
	"Vila Alice":      "Vila Flor",
	"Vila Estoril":    "Cassequel",
	"Bairro Operário": "Maianga",
	"Bairro Azul":     "Maianga",
	"Bairro das Tendas": "Rangel",
	"Tala-Alice":      "Tala Hady",
}

func main() {
	dbPath := os.Getenv("LISTINGS_DB")
	if dbPath == "" {
		dbPath = "listings.db"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	log.Printf("using database: %s", dbPath)

	if err := initDB(); err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/listings", handleListings)
	http.HandleFunc("/api/nearby", handleNearby)
	http.HandleFunc("/api/refresh", handleRefresh)
	http.HandleFunc("/api/refresh/stream", handleRefreshStream)
	http.HandleFunc("/api/sync-status", handleSyncStatus)
	http.HandleFunc("/api/parse-audit", handleParseAudit)
	http.HandleFunc("/api/counts", handleCounts)

	log.Printf("Server running at http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
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
			location_raw TEXT,
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
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
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

	query := "SELECT msg_id, chat_name, chat_jid, timestamp, sender, sender_jid, title, typology, price, price_text, location, location_raw, phone, raw_text, category FROM listings WHERE category = ?"
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
		if n, err := strconv.Atoi(minPrice); err == nil {
			query += " AND price >= ?"
			args = append(args, n)
		}
	}
	if maxPrice != "" {
		if n, err := strconv.Atoi(maxPrice); err == nil {
			query += " AND price <= ?"
			args = append(args, n)
		}
	}
	if search != "" {
		query += " AND (raw_text LIKE ? OR title LIKE ?)"
		s := "%" + search + "%"
		args = append(args, s, s)
	}

	if sortDir == "asc" {
		query += fmt.Sprintf(" ORDER BY CASE WHEN %s IS NULL OR %s = '' THEN 1 ELSE 0 END, %s ASC, timestamp DESC LIMIT 500", sortCol, sortCol, sortCol)
	} else {
		query += fmt.Sprintf(" ORDER BY CASE WHEN %s IS NULL OR %s = '' THEN 1 ELSE 0 END, %s DESC, timestamp DESC LIMIT 500", sortCol, sortCol, sortCol)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type Row struct {
		MsgID       string `json:"msg_id"`
		ChatName    string `json:"chat_name"`
		ChatJID     string `json:"chat_jid"`
		Timestamp   string `json:"timestamp"`
		Sender      string `json:"sender"`
		SenderJID   string `json:"sender_jid"`
		Title       string `json:"title"`
		Typology    string `json:"typology"`
		Price       int    `json:"price"`
		PriceText   string `json:"price_text"`
		Location    string `json:"location"`
		LocationRaw string `json:"location_raw"`
		Phone       string `json:"phone"`
		RawText     string `json:"raw_text"`
		Category    string `json:"category"`
	}

	var out []Row
	for rows.Next() {
		var r Row
		rows.Scan(&r.MsgID, &r.ChatName, &r.ChatJID, &r.Timestamp, &r.Sender, &r.SenderJID, &r.Title, &r.Typology, &r.Price, &r.PriceText, &r.Location, &r.LocationRaw, &r.Phone, &r.RawText, &r.Category)
		out = append(out, r)
	}
	if out == nil {
		out = []Row{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}

// ---------- Proximity ----------

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func resolveCoords(location, locationRaw string) (lat, lng float64, ok bool) {
	key := location
	if p, exists := parentLocation[key]; exists {
		key = p
	}
	if c, exists := locationCoords[key]; exists {
		return c[0], c[1], true
	}
	// Fallback: try to normalize from raw text via the existing matcher.
	if locationRaw != "" {
		if loc := matchLocation(locationRaw); loc != "" {
			if p, exists := parentLocation[loc]; exists {
				loc = p
			}
			if c, exists := locationCoords[loc]; exists {
				return c[0], c[1], true
			}
		}
	}
	return 0, 0, false
}

func handleNearby(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	latStr, lngStr := q.Get("lat"), q.Get("lng")
	if latStr == "" || lngStr == "" {
		http.Error(w, "lat/lng required", 400)
		return
	}
	lat, err1 := strconv.ParseFloat(latStr, 64)
	lng, err2 := strconv.ParseFloat(lngStr, 64)
	if err1 != nil || err2 != nil {
		http.Error(w, "invalid lat/lng", 400)
		return
	}

	maxKm := 0.0
	if s := q.Get("max_km"); s != "" {
		maxKm, _ = strconv.ParseFloat(s, 64)
	}
	category := q.Get("category")
	if category == "" {
		category = "rental"
	}
	typology := q.Get("typology")

	query := `SELECT msg_id, chat_name, timestamp, sender, title, typology,
	                 price, price_text, location, location_raw, phone, raw_text, category
	          FROM listings WHERE category = ?`
	args := []interface{}{category}
	if typology != "" {
		query += " AND typology = ?"
		args = append(args, typology)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type Row struct {
		MsgID       string  `json:"msg_id"`
		ChatName    string  `json:"chat_name"`
		Timestamp   string  `json:"timestamp"`
		Sender      string  `json:"sender"`
		Title       string  `json:"title"`
		Typology    string  `json:"typology"`
		Price       int     `json:"price"`
		PriceText   string  `json:"price_text"`
		Location    string  `json:"location"`
		LocationRaw string  `json:"location_raw"`
		Phone       string  `json:"phone"`
		RawText     string  `json:"raw_text"`
		Category    string  `json:"category"`
		DistanceKm  float64 `json:"distance_km"`
		Lat         float64 `json:"lat"`
		Lng         float64 `json:"lng"`
	}

	var out []Row
	for rows.Next() {
		var r Row
		rows.Scan(&r.MsgID, &r.ChatName, &r.Timestamp, &r.Sender, &r.Title,
			&r.Typology, &r.Price, &r.PriceText, &r.Location, &r.LocationRaw,
			&r.Phone, &r.RawText, &r.Category)

		clat, clng, ok := resolveCoords(r.Location, r.LocationRaw)
		if !ok {
			continue
		}
		r.Lat, r.Lng = clat, clng
		r.DistanceKm = haversineKm(lat, lng, clat, clng)
		if maxKm > 0 && r.DistanceKm > maxKm {
			continue
		}
		out = append(out, r)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].DistanceKm < out[j].DistanceKm
	})

	if len(out) > 500 {
		out = out[:500]
	}
	if out == nil {
		out = []Row{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}

// ---------- Refresh ----------

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

func handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	result := map[string]string{}

	if dbPath := os.Getenv("LISTINGS_DB"); dbPath != "" {
		result["DB_PATH"] = dbPath
	} else {
		result["DB_PATH"] = "listings.db (default)"
	}
	if port := os.Getenv("PORT"); port != "" {
		result["PORT"] = port
	} else {
		result["PORT"] = "8090 (default)"
	}

	doctorCmd := exec.Command("wacli-pro", "doctor")
	if output, err := doctorCmd.Output(); err == nil {
		for _, line := range strings.Split(string(output), "\n") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				key := parts[0]
				value := strings.Join(parts[1:], " ")
				result[key] = value
			}
		}
	} else {
		result["error"] = err.Error()
	}

	listCmd := exec.Command("wacli-pro", "messages", "list", "--json", "--limit", "1")
	if output, err := listCmd.Output(); err == nil {
		var resp WacliResponse
		if err := json.Unmarshal(output, &resp); err == nil && len(resp.Data.Messages) > 0 {
			result["LAST_SYNC"] = resp.Data.Messages[0].Timestamp
		}
	}

	if result["LAST_SYNC"] == "" {
		var ts sql.NullString
		_ = db.QueryRow(`SELECT MAX(timestamp) FROM listings`).Scan(&ts)
		if ts.Valid {
			result["LAST_SYNC"] = ts.String
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(result)
}

// ---------- Parse audit ----------

// handleParseAudit re-runs the parser against every stored raw_text and reports
// rows where the current parser disagrees with the category stored at insert
// time. Used to find misclassification bugs. With the seeded dev DB, the
// stored category is ground truth, so any mismatch is a real parser error.
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

// ---------- Counts ----------

// handleCounts returns per-category totals plus a grand total. Used by the
// frontend to display true counts even when /api/listings is capped at 500.
func handleCounts(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT category, COUNT(*) FROM listings GROUP BY category`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	out := map[string]int{}
	total := 0
	for rows.Next() {
		var c string
		var n int
		if err := rows.Scan(&c, &n); err != nil {
			continue
		}
		out[c] = n
		total += n
	}
	out["total"] = total

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}