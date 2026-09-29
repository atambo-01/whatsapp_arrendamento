package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"strings"
)

type sendRequest struct {
	To      string `json:"to"`
	Message string `json:"message"`
	MsgID   string `json:"msg_id"`
	ChatJID string `json:"chat_jid"`
}

type sendResponse struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Command string `json:"command,omitempty"`
}

// handleSend relays a message to wacli-pro. If MsgID + ChatJID are set, the
// outgoing message is sent as a quoted reply to that message, so the
// recipient sees exactly which listing is being referenced.
func handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req sendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSendJSON(w, http.StatusBadRequest, sendResponse{OK: false, Error: "invalid JSON"})
		return
	}

	to := strings.TrimSpace(req.To)
	msg := strings.TrimSpace(req.Message)
	msgID := strings.TrimSpace(req.MsgID)
	chatJID := strings.TrimSpace(req.ChatJID)
	if to == "" || msg == "" {
		writeSendJSON(w, http.StatusBadRequest, sendResponse{OK: false, Error: "missing 'to' or 'message'"})
		return
	}

	args := []string{"send", "text", "--to", to, "--message", msg}
	if msgID != "" {
		args = append(args, "--reply-to", msgID)
		if chatJID != "" {
			args = append(args, "--reply-chat", chatJID)
		}
	}

	cmd := exec.Command("wacli-pro", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("send failed: to=%s reply-to=%s reply-chat=%s err=%v out=%s",
			to, msgID, chatJID, err, string(out))
		writeSendJSON(w, http.StatusInternalServerError, sendResponse{
			OK:    false,
			Error: strings.TrimSpace(string(out)),
		})
		return
	}

	log.Printf("sent message to %s reply-to=%s reply-chat=%s (%d chars)",
		to, msgID, chatJID, len(msg))
	writeSendJSON(w, http.StatusOK, sendResponse{
		OK:      true,
		Command: "wacli-pro send text --to " + to + " --reply-to " + msgID + " --reply-chat " + chatJID,
	})
}

func writeSendJSON(w http.ResponseWriter, status int, payload sendResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}