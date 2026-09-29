# Operations

Day-to-day commands, environment variables, and troubleshooting.

## Environment variables

| Variable | Default | Purpose |
| -- | -- | -- |
| `LISTINGS_DB` | `listings.db` | SQLite database path |
| `PORT` | `8090` | HTTP listen port |
| `WACLI_DB` | `~/.wacli-pro/wacli.db` | Path to wacli-pro's store (read-only) |

Run a dev instance alongside production:

    LISTINGS_DB=listings.dev.db PORT=8091 make run

--

## Makefile targets

| Target | What it does |
| -- | -- |
| `make build` | Compile the binary (`listings` / `listings.exe`) |
| `make run` | Build then run in foreground |
| `make run-dev` | Build + seed + run against `listings.dev.db` |
| `make seed` | Generate 400 fake listings into `listings.dev.db` |
| `make seed-backfill` | Seed backfill mode (see `seed/main.go`) |
| `make restart` | Rebuild and restart the systemd user service (Linux only) |
| `make stop` | Stop the systemd service and any `listings` process |
| `make status` | Service state, wacli store stats, DB counts, HTTP check |
| `make backfill` | Media backfill — see below |
| `make clean` | Remove built binary and dev DB |

--

## Common workflows

### Refresh the listings

**From the UI:** click "Refresh from WhatsApp". It streams progress via SSE.

**From the shell:**

    curl -X POST "http://localhost:8090/api/refresh"

**Force a full reparse** (ignore the `sync_state` watermark — use after
changing the parser):

    curl -X POST "http://localhost:8090/api/refresh?full=1"

### Backfill old media

Messages synced before the daemon had `-download-media` set have
`media_type` populated but `local_path` NULL. Their images and videos
don't render.

Run the backfill script:

    make backfill                    # last 30 days, all
    make backfill DAYS=60            # last 60 days
    make backfill DAYS=30 LIMIT=500  # just 500

The script:

1. Queries `wacli.db` for messages with missing media
2. Filters out previously failed items (tracked in `backfill_media_fail.log`)
3. Generates a flat `wacli-pro media download` script
4. Runs it with a progress bar
5. Reports how many succeeded / failed

Failed items are usually `invalid media hmac` — the file no longer exists
on WhatsApp's servers. Nothing can be done about those.

To retry failures (e.g. if network hiccups caused transient errors):

    rm backfill_media_fail.log
    make backfill

**Requires the daemon to be running.** If it's not, the script exits early
with a clear message.

### Send a test message

    curl -X POST http://localhost:8090/api/send \
      -H 'Content-Type: application/json' \
      -d '{"to":"<jid>","message":"test","msg_id":"<listing>","chat_jid":"<group>"}'

--

## The wacli-pro daemon

The daemon is what keeps the WhatsApp connection alive and syncs messages
into `wacli.db`. It's a separate process from the app.

### Check status

    wacli-pro daemon status

On Windows (as a service), this may fail with `Acesso negado` if you're
not elevated. Use `tasklist | grep wacli` or `ps aux | grep wacli-pro`
instead.

### Start / stop

**Linux:**

    wacli-pro daemon start -download-media
    wacli-pro daemon stop

**Windows:**

    wacli-pro daemon start -download-media
    wacli-pro daemon stop

The service is installed as `wacli-sync`. Start/stop needs admin rights.

**Foreground mode** (no service, no admin):

    wacli-pro daemon run -store C:/Users/<you>/.wacli-pro -download-media

Runs in the terminal, Ctrl+C to stop. Dies when the terminal closes.

### Logs

    tail -f ~/.wacli-pro/daemon.log

On Windows: `tail -f /c/Users/<you>/.wacli-pro/daemon.log`.

--

## Troubleshooting

### store is locked (another wacli is running?)

The daemon holds the store lock. Anything that writes to `wacli.db` —
including on-demand media downloads from the app — will fail while the
daemon is actively syncing.

**Workaround:** stop the daemon when you're going to browse listings with
missing media.

    wacli-pro daemon stop
    # browse, let the app fetch on-demand
    wacli-pro daemon start -download-media

This limitation goes away with the planned `whatsmeow` migration.

### invalid media hmac

The media file is gone from WhatsApp's servers. Permanent. If it doesn't
load on WhatsApp's own app either, there's nothing to recover.

### address already in use on startup

Something is on port 8090:

    ss -tlnp | grep 8090

If it's the systemd service, `make stop` first. If it's a leftover
process, kill it.

### /api/nearby returns fewer rows than /api/listings

Expected. Proximity mode drops listings whose location string isn't in
`coords.go`. Add the missing neighborhood to fix — see ARCHITECTURE.md.

### Blank page after an update

Hard-reload (Ctrl+Shift+R). The server sends `Cache-Control: no-store` on
HTML and JS, but a cached HTML can still be held by the browser.

### Parser changed but old rows look wrong

After a parser change, run a full reparse to reclassify everything:

    curl -X POST "http://localhost:8090/api/refresh?full=1"

### Check what the parser disagrees with

    curl "http://localhost:8090/api/parse-audit?category=noise&limit=200" | python -m json.tool

Returns rows where the stored category differs from what the current
parser would produce. Useful after tweaking `reRentalVerb` /
`reSeekerVerb` / `reSaleVerb`.

--

## Dev mode

Use the seeded DB so your real data stays untouched:

    make stop        # free :8090 if the service is running
    make run-dev     # builds, seeds listings.dev.db, runs foreground

The dev server logs `using database: listings.dev.db` at startup. Ctrl+C
stops it.

**Do not click "Refresh from WhatsApp" against the dev DB** — it pulls
real messages into your seeded data. Reset with:

    make clean && make run-dev

The seed is deterministic (`-seed 42` by default) so bug reports are
reproducible.

--

## Windows notes

- Use MSYS2 / UCRT64 for a proper bash shell.
- `make` works if you install `mingw-w64-ucrt-x86_64-make` (or just use
  the MSYS2 `make`).
- Simplewall (or another firewall) must allow `go.exe` and
  `wacli-pro.exe` outbound. The build downloads Go modules; the daemon
  connects to WhatsApp.
- Paths: `~/.wacli-pro` maps to `C:\Users\<you>\.wacli-pro` in the shell.
  UCRT64's `~` expands to `/home/<you>` which is different — use
  `/c/Users/<you>/...` explicitly when the distinction matters.

--

## Backup

`listings.db` is the only file you can't regenerate from `wacli.db` —
everything else is derived.

    sqlite3 listings.db ".backup listings_backup_$(date +%Y%m%d).db"

Run this before risky operations (schema changes, full reparses).