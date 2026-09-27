package main

import (
	"database/sql"
	"embed"
	"log"
	"net/http"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed web
var webFS embed.FS

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
	// Serve static files from the embedded web/ directory.
	// "/" maps to web/index.html implicitly.
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}
	data, err := webFS.ReadFile("web/" + path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch {
	case strings.HasSuffix(path, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case strings.HasSuffix(path, ".js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	default:
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Write(data)
}