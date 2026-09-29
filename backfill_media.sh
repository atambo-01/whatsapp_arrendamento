#!/usr/bin/env bash
# Backfill missing WhatsApp media. See bottom of file for usage.
#
# Failed items are recorded in backfill_media_fail.log and skipped on
# subsequent runs. To retry them, delete that file.

set -u

DAYS="${1:-30}"
LIMIT="${2:-0}"
FILTER="${3:-}"

WACLI_DB="${WACLI_DB:-$HOME/.wacli-pro/wacli.db}"
if [ ! -f "$WACLI_DB" ] && [ -f "/c/Users/$USER/.wacli-pro/wacli.db" ]; then
  WACLI_DB="/c/Users/$USER/.wacli-pro/wacli.db"
fi

if [ ! -f "$WACLI_DB" ]; then
  echo "✗ wacli.db not found. Set WACLI_DB=/path/to/wacli.db" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_QUERY="$SCRIPT_DIR/.backfill_query.txt"
TMP_SCRIPT="$SCRIPT_DIR/.backfill_script.sh"
LOG_FILE="$SCRIPT_DIR/backfill_media.log"
FAIL_FILE="$SCRIPT_DIR/backfill_media_fail.log"

# ---------- 0. Preflight ----------

if ! command -v wacli-pro >/dev/null 2>&1; then
  echo "✗ wacli-pro not in PATH" >&2
  exit 1
fi

if ! wacli-pro daemon status 2>&1 | grep -q "running"; then
  echo "✗ wacli-pro daemon is not running."
  echo "  Start it with: wacli-pro daemon start --download-media"
  exit 1
fi

# ---------- 1. Query ----------

echo "→ Querying wacli.db for missing media (last ${DAYS} days)…"

LIMIT_SQL=""
if [ "$LIMIT" -gt 0 ] 2>/dev/null; then
  LIMIT_SQL=" LIMIT $LIMIT"
fi

FILTER_SQL=""
if [ -n "$FILTER" ]; then
  FILTER_SQL=" AND chat_jid LIKE '%${FILTER}%'"
fi

sqlite3 -separator '|' "$WACLI_DB" "
  SELECT chat_jid, msg_id FROM messages
  WHERE media_type IN ('image','video')
    AND (local_path IS NULL OR local_path = '')
    AND chat_jid NOT LIKE 'status@%'
    AND ts > strftime('%s','now','-${DAYS} days')
    ${FILTER_SQL}
  ORDER BY ts DESC
  ${LIMIT_SQL}
" > "$TMP_QUERY"

if [ -f "$FAIL_FILE" ] && [ -s "$FAIL_FILE" ]; then
  FAILED_COUNT=$(wc -l < "$FAIL_FILE" | tr -d ' ')
  echo "  Skipping ${FAILED_COUNT} previously failed items."
  grep -vF -f "$FAIL_FILE" "$TMP_QUERY" > "${TMP_QUERY}.filtered" || true
  mv "${TMP_QUERY}.filtered" "$TMP_QUERY"
fi

TOTAL=$(wc -l < "$TMP_QUERY" | tr -d ' ')
if [ "$TOTAL" -eq 0 ]; then
  echo "✓ Nothing left to download."
  rm -f "$TMP_QUERY"
  exit 0
fi

echo "  Found ${TOTAL} items to download."
echo "  Roughly $((TOTAL * 2 / 60)) minutes."
echo

# ---------- 2. Generate script ----------

awk -F'|' '{ printf "wacli-pro media download --chat \"%s\" --id \"%s\"\n", $1, $2 }' \
  "$TMP_QUERY" > "$TMP_SCRIPT"

# ---------- 3. Run with progress bar ----------

: > "$LOG_FILE"

bar() {
  local cur=$1 total=$2 width=40
  local pct=$(( cur * 100 / total ))
  local filled=$(( cur * width / total ))
  local empty=$(( width - filled ))
  local fill_str empty_str
  printf -v fill_str '%*s' "$filled" ''
  printf -v empty_str '%*s' "$empty" ''
  printf '\r  [%s%s] %3d%%  %d/%d' \
    "${fill_str// /#}" "${empty_str// /-}" "$pct" "$cur" "$total"
}

ok=0
fail=0
i=0

while IFS= read -r line; do
  i=$((i + 1))
  # Execute one command, capture stdout+stderr for the log.
  out=$(eval "$line" 2>&1)
  echo "$out" >> "$LOG_FILE"
  echo "---" >> "$LOG_FILE"

  if echo "$out" | grep -q "bytes)"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
  fi

  bar "$i" "$TOTAL"
done < "$TMP_SCRIPT"

echo
echo

# ---------- 4. Report ----------

# Re-query to find what's still missing and mark as failed.
sqlite3 -separator '|' "$WACLI_DB" "
  SELECT chat_jid, msg_id FROM messages
  WHERE media_type IN ('image','video')
    AND (local_path IS NULL OR local_path = '')
    AND chat_jid NOT LIKE 'status@%'
    AND ts > strftime('%s','now','-${DAYS} days')
    ${FILTER_SQL}
" > "${TMP_QUERY}.after"

if [ -f "$FAIL_FILE" ]; then
  cat "$FAIL_FILE" "${TMP_QUERY}.after" | sort -u > "${FAIL_FILE}.new"
  mv "${FAIL_FILE}.new" "$FAIL_FILE"
else
  cp "${TMP_QUERY}.after" "$FAIL_FILE"
fi

TOTAL_FAIL=$(wc -l < "$FAIL_FILE" | tr -d ' ')

echo "─────────────────────────────"
echo "  Attempted       : $TOTAL"
echo "  Succeeded       : $ok"
echo "  Failed this run : $fail"
echo "  Total failed    : $TOTAL_FAIL  ($(basename "$FAIL_FILE"))"
echo "  Log             : $LOG_FILE"
echo "─────────────────────────────"

rm -f "$TMP_QUERY" "${TMP_QUERY}.after" "$TMP_SCRIPT"