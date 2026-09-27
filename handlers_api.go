package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

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
		query += " ORDER BY CASE WHEN " + sortCol + " IS NULL OR " + sortCol + " = '' THEN 1 ELSE 0 END, " + sortCol + " ASC, timestamp DESC LIMIT 500"
	} else {
		query += " ORDER BY CASE WHEN " + sortCol + " IS NULL OR " + sortCol + " = '' THEN 1 ELSE 0 END, " + sortCol + " DESC, timestamp DESC LIMIT 500"
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