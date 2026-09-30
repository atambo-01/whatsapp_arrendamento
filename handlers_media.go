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

var wacliDB *sql.DB

type MediaRef struct {
	MsgID string `json:"msg_id"`
	URL   string `json:"url"`
	Type  string `json:"type"`
	Mime  string `json:"mime"`
}

type downloadState struct {
	mu       sync.Mutex
	inflight map[string]bool
	failed   map[string]time.Time
	lockWarn time.Time
}

var dlState = &downloadState{
	inflight: map[string]bool{},
	failed:   map[string]time.Time{},
}

const (
	failedRetryAfter = 10 * time.Minute
	lockRetryAfter   = 2 * time.Minute
	lockWarnCooldown = 1 * time.Minute
)

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
		priceOk                                 sql.NullInt64
	)
	err := db.QueryRow(`
		SELECT msg_id, chat_name, chat_jid, timestamp, sender, sender_jid,
		       title, typology, price, price_text, price_ok, location, location_raw,
		       phone, raw_text, category
		FROM listings WHERE msg_id = ?`, id).
		Scan(&msgID, &chatName, &chatJID, &timestamp, &sender, &senderJID,
			&title, &typology, &price, &priceText, &priceOk, &location, &locationRaw,
			&phone, &rawText, &category)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", 404)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	pok := -1
	if priceOk.Valid {
		pok = int(priceOk.Int64)
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
		"price_ok":     pok,
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
			if isStoreLocked(err) {
				logStoreLockWarn()
				markDownloadFailed(id, lockRetryAfter)
			} else {
				log.Printf("on-demand download failed id=%s chat=%s: %v", id, chatJID, err)
				markDownloadFailed(id, failedRetryAfter)
			}
			http.Error(w, "media unavailable", 404)
			return
		}
		localPath, mimeType, err = lookupMedia(id)
		if err != nil || localPath == "" {
			markDownloadFailed(id, failedRetryAfter)
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

func markDownloadFailed(msgID string, after time.Duration) {
	dlState.mu.Lock()
	defer dlState.mu.Unlock()
	delete(dlState.inflight, msgID)
	dlState.failed[msgID] = time.Now()
}

func isStoreLocked(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "store is locked") ||
		strings.Contains(s, "outro processo bloqueou")
}

func logStoreLockWarn() {
	dlState.mu.Lock()
	last := dlState.lockWarn
	dlState.lockWarn = time.Now()
	dlState.mu.Unlock()

	if time.Since(last) < lockWarnCooldown {
		return
	}
	log.Printf("media download: store locked by another wacli process. " +
		"Stop the daemon (`wacli-pro daemon stop`) while the app is fetching media.")
}

func downloadMedia(chatJID, msgID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
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