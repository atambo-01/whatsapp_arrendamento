package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// wacliDB is a read-only handle on wacli-pro's store.
var wacliDB *sql.DB

// MediaRef describes one media file attached to a listing.
type MediaRef struct {
	MsgID string `json:"msg_id"`
	URL   string `json:"url"`
	Type  string `json:"type"`
	Mime  string `json:"mime"`
}

// downloadState tracks in-flight and recently failed downloads so we don't
// hammer WhatsApp when a listing with dead media is opened repeatedly.
type downloadState struct {
	mu       sync.Mutex
	inflight map[string]bool      // msg_id -> currently downloading
	failed   map[string]time.Time // msg_id -> last failure time
}

var dlState = &downloadState{
	inflight: map[string]bool{},
	failed:   map[string]time.Time{},
}

const failedRetryAfter = 10 * time.Minute

// defaultWacliDB resolves the wacli-pro store path.
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

// initWacliDB opens the wacli-pro store read-only.
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

// imagesForListing finds media that belongs to a listing. The pattern in
// these groups is: text post → images follow within seconds, from the same
// sender in the same chat. We scan forward up to 10 minutes, stopping early
// if we hit a message with substantial text.
//
// Includes items whose local_path is NULL — the download happens lazily in
// handleImage when the browser actually requests the file.
func imagesForListing(msgID, chatJID, senderJID, ts string) []MediaRef {
	if wacliDB == nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04:05Z", ts)
		if err != nil {
			return nil
		}
	}
	tsFrom := t.Unix()
	tsTo := t.Add(10 * time.Minute).Unix()

	rows, err := wacliDB.Query(`
		SELECT msg_id, media_type, mime_type, text
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
			id, mediaType, mime sql.NullString
			text                sql.NullString
		)
		if err := rows.Scan(&id, &mediaType, &mime, &text); err != nil {
			continue
		}
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

// handleListing returns a single listing row plus its associated media.
func handleListing(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/listing/")
	if id == "" {
		http.Error(w, "missing msg_id", 400)
		return
	}

	var (
		msgID, chatName, chatJID, timestamp     string
		sender, senderJID, title, typology      string
		priceText, location, locationRaw, phone string
		rawText, category                       string
		price                                   int
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

// handleImage streams a media file from wacli-pro's local store. If the file
// hasn't been downloaded yet, it triggers a wacli-pro download inline (up to
// ~15s), then serves the file.
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

	localPath, mimeType, err := lookupMedia(id)
	if err != nil {
		http.Error(w, "media not found", 404)
		return
	}

	// If we don't have it locally, try to download it on-demand.
	if localPath == "" {
		if !shouldAttemptDownload(id) {
			http.Error(w, "media unavailable (retry skipped)", 404)
			return
		}
		chatJID := lookupChatJID(id)
		if chatJID == "" {
			http.Error(w, "media chat unknown", 404)
			return
		}
		if err := downloadMedia(chatJID, id); err != nil {
			markDownloadFailed(id)
			log.Printf("on-demand download failed id=%s chat=%s: %v", id, chatJID, err)
			http.Error(w, "media unavailable", 404)
			return
		}
		// Re-lookup after download.
		localPath, mimeType, err = lookupMedia(id)
		if err != nil || localPath == "" {
			markDownloadFailed(id)
			http.Error(w, "media unavailable after download", 404)
			return
		}
		clearDownloadState(id)
	}

	f, err := os.Open(localPath)
	if err != nil {
		log.Printf("handleImage open %s: %v", localPath, err)
		http.Error(w, "file unavailable", 404)
		return
	}
	defer f.Close()

	ct := mimeType
	if ct == "" {
		ct = guessMime(localPath)
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeContent(w, r, filepath.Base(localPath), time.Time{}, f)
}

// ---------- Helpers ----------

func lookupMedia(msgID string) (localPath, mimeType string, err error) {
	var lp, mt sql.NullString
	err = wacliDB.QueryRow(`
		SELECT local_path, mime_type FROM messages WHERE msg_id = ? LIMIT 1`, msgID).
		Scan(&lp, &mt)
	if err != nil {
		return "", "", err
	}
	if lp.Valid {
		localPath = lp.String
	}
	if mt.Valid {
		mimeType = mt.String
	}
	return localPath, mimeType, nil
}

func lookupChatJID(msgID string) string {
	var cj sql.NullString
	err := wacliDB.QueryRow(`
		SELECT chat_jid FROM messages WHERE msg_id = ? LIMIT 1`, msgID).Scan(&cj)
	if err != nil || !cj.Valid {
		return ""
	}
	return cj.String
}

func shouldAttemptDownload(msgID string) bool {
	dlState.mu.Lock()
	defer dlState.mu.Unlock()
	if dlState.inflight[msgID] {
		return false
	}
	if t, ok := dlState.failed[msgID]; ok {
		if time.Since(t) < failedRetryAfter {
			return false
		}
	}
	dlState.inflight[msgID] = true
	return true
}

func clearDownloadState(msgID string) {
	dlState.mu.Lock()
	defer dlState.mu.Unlock()
	delete(dlState.inflight, msgID)
	delete(dlState.failed, msgID)
}

func markDownloadFailed(msgID string) {
	dlState.mu.Lock()
	defer dlState.mu.Unlock()
	delete(dlState.inflight, msgID)
	dlState.failed[msgID] = time.Now()
}

// downloadMedia runs `wacli-pro media download` synchronously with a timeout.
func downloadMedia(chatJID, msgID string) error {
	ctx, cancel := contextWithTimeout(15 * time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "wacli-pro",
		"media", "download", "--chat", chatJID, "--id", msgID)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func guessMime(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".jfif":
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

// contextWithTimeout is a small wrapper so the imports stay tidy.
func contextWithTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}