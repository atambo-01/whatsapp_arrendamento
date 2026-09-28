package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// wacliDB is a read-only handle on wacli-pro's store. It's separate from the
// listings DB — that one holds parsed results, this one holds raw messages
// and media paths.
var wacliDB *sql.DB

// MediaRef describes one media file attached (directly or via follow-up) to a
// listing. URL is the app-relative endpoint the browser should hit.
type MediaRef struct {
	MsgID string `json:"msg_id"`
	URL   string `json:"url"`
	Type  string `json:"type"` // "image" | "video"
	Mime  string `json:"mime"`
}

// defaultWacliDB resolves the wacli-pro store path. WACLI_DB env var wins if
// set; otherwise ~/.wacli-pro/wacli.db, which os.UserHomeDir() maps correctly
// on both Linux (/home/alex) and Windows (C:\Users\alex).
func defaultWacliDB() string {
	if p := os.Getenv("WACLI_DB"); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".wacli-pro", "wacli.db")
}

// initWacliDB opens the wacli-pro store read-only. Failure is non-fatal: the
// main UI still works without it, media lookups just come back empty.
func initWacliDB() {
	path := defaultWacliDB()
	if path == "" {
		log.Printf("wacli DB: cannot resolve home dir, media disabled")
		return
	}
	if _, err := os.Stat(path); err != nil {
		log.Printf("wacli DB: not found at %s, media disabled", path)
		return
	}

	// modernc.org/sqlite supports mode=ro via DSN query params.
	dsn := "file:" + path + "?mode=ro&_pragma=busy_timeout(5000)"
	h, err := sql.Open("sqlite", dsn)
	if err != nil {
		log.Printf("wacli DB: open failed: %v", err)
		return
	}
	if err := h.Ping(); err != nil {
		log.Printf("wacli DB: ping failed: %v", err)
		h.Close()
		return
	}
	wacliDB = h
	log.Printf("wacli DB: opened %s (read-only)", path)
}

// imagesForListing finds media that belongs to a listing. The pattern in these
// groups is: text post → images follow within seconds, from the same sender in
// the same chat. We scan forward up to 10 minutes, stopping early if we hit a
// message with substantial text (that's the next listing starting).
//
// We don't rely on the listing message carrying media itself — it almost never
// does. This is a heuristic, and it's the one the original implementation used.
func imagesForListing(msgID, chatJID, senderJID, ts string) []MediaRef {
	if wacliDB == nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		// Try the wacli-pro format without timezone offset variants.
		t, err = time.Parse("2006-01-02T15:04:05Z", ts)
		if err != nil {
			return nil
		}
	}
	tsFrom := t.Unix()
	tsTo := t.Add(10 * time.Minute).Unix()

	rows, err := wacliDB.Query(`
		SELECT msg_id, media_type, mime_type, text, display_text
		FROM messages
		WHERE chat_jid = ?
		  AND sender_jid = ?
		  AND ts > ?
		  AND ts <= ?
		  AND revoked = 0
		ORDER BY ts ASC
		LIMIT 30`,
		chatJID, senderJID, tsFrom, tsTo)
	if err != nil {
		log.Printf("imagesForListing query: %v", err)
		return nil
	}
	defer rows.Close()

	var refs []MediaRef
	for rows.Next() {
		var (
			id, mediaType, mime   sql.NullString
			text, displayText     sql.NullString
		)
		if err := rows.Scan(&id, &mediaType, &mime, &text, &displayText); err != nil {
			continue
		}
		// Stop when the next listing begins.
		if strings.TrimSpace(text.String) != "" && len(strings.TrimSpace(text.String)) > 30 {
			break
		}
		mt := mediaType.String
		if mt != "image" && mt != "video" {
			continue
		}
		refs = append(refs, MediaRef{
			MsgID: id.String,
			URL:   "/api/image/" + id.String,
			Type:  mt,
			Mime:  mime.String,
		})
	}
	return refs
}

// msgIDsWithImages is a small helper for debugging / future use. Returns the
// set of msg_ids in a chat that have a downloadable local file.
func msgIDsWithImages(chatJID string, limit int) map[string]bool {
	out := map[string]bool{}
	if wacliDB == nil {
		return out
	}
	rows, err := wacliDB.Query(`
		SELECT msg_id FROM messages
		WHERE chat_jid = ?
		  AND media_type IN ('image','video')
		  AND local_path IS NOT NULL
		  AND local_path != ''
		ORDER BY ts DESC LIMIT ?`, chatJID, limit)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			out[id] = true
		}
	}
	return out
}

// handleListing returns a single listing row plus its associated media.
// URL: GET /api/listing/{msg_id}
func handleListing(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/listing/")
	if id == "" {
		http.Error(w, "missing msg_id", 400)
		return
	}

	var (
		msgID, chatName, chatJID, timestamp          string
		sender, senderJID, title, typology           string
		priceText, location, locationRaw, phone      string
		rawText, category                            string
		price                                        int
	)
	err := db.QueryRow(`
		SELECT msg_id, chat_name, chat_jid, timestamp, sender, sender_jid,
		       title, typology, price, price_text, location, location_raw,
		       phone, raw_text, category
		FROM listings WHERE msg_id = ?`, id).
		Scan(&msgID, &chatName, &chatJID, &timestamp, &sender, &senderJID,
			&title, &typology, &price, &priceText, &location, &locationRaw,
			&phone, &rawText, &category)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", 404)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	media := imagesForListing(msgID, chatJID, senderJID, timestamp)
	if media == nil {
		media = []MediaRef{}
	}

	out := map[string]interface{}{
		"msg_id":       msgID,
		"chat_name":    chatName,
		"chat_jid":     chatJID,
		"timestamp":    timestamp,
		"sender":       sender,
		"sender_jid":   senderJID,
		"title":        title,
		"typology":     typology,
		"price":        price,
		"price_text":   priceText,
		"location":     location,
		"location_raw": locationRaw,
		"phone":        phone,
		"raw_text":     rawText,
		"category":     category,
		"media":        media,
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}

// handleImage streams a media file from wacli-pro's local store.
// URL: GET /api/image/{msg_id}
func handleImage(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/image/")
	if id == "" {
		http.Error(w, "missing msg_id", 400)
		return
	}
	if wacliDB == nil {
		http.Error(w, "media store unavailable", 503)
		return
	}

	var localPath, mimeType sql.NullString
	err := wacliDB.QueryRow(`
		SELECT local_path, mime_type FROM messages WHERE msg_id = ? LIMIT 1`, id).
		Scan(&localPath, &mimeType)
	if err != nil || !localPath.Valid || localPath.String == "" {
		http.Error(w, "media not found", 404)
		return
	}

	// wacli stores absolute paths on Windows (C:\...) and Linux (/home/...).
	// Serve directly — no path joining needed.
	f, err := os.Open(localPath.String)
	if err != nil {
		log.Printf("handleImage open %s: %v", localPath.String, err)
		http.Error(w, "file unavailable", 404)
		return
	}
	defer f.Close()

	ct := mimeType.String
	if ct == "" {
		ct = guessMime(localPath.String)
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeContent(w, r, filepath.Base(localPath.String), time.Time{}, f)
}

func guessMime(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	}
	return "application/octet-stream"
}

// Silence unused-import warnings in case fmt isn't referenced yet.
var _ = fmt.Sprintf