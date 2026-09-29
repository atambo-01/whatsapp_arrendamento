# Architecture

## Overview

The app is a pipeline:

    WhatsApp servers
          │
          │  (WhatsApp Web protocol, via wacli-pro)
          ▼
    ~/.wacli-pro/wacli.db          ← raw message firehose (owned by the daemon)
          │
          │  (read-only)
          ▼
    handlers_refresh.go → parser.go → listings.db
          │                              │
          │                              │  (read-only)
          │                              ▼
          │                        HTTP handlers → web UI
          │
          └─ media files in ~/.wacli-pro/media/<chat>/<msg_id>/<type>/

Two SQLite databases, two purposes:

1. **~/.wacli-pro/wacli.db** — owned by the `wacli-pro` daemon. Contains
   every message from every chat, plus media metadata and download paths.
   The app opens it **read-only** for media lookups and the time-windowed
   refresh.

2. **listings.db** — owned by the app. Contains only the parsed listings.
   Written by `refreshOnce`, read by the API handlers.

The two are kept in sync by one rule: whenever `refreshOnce` runs, it walks
forward from the last-parsed timestamp in `listings.db`'s `sync_state`
table, parses everything newer in `wacli.db`, and inserts the results.

--

## Refresh flow

1. UI hits `POST /api/refresh`, or `handleRefreshStream` for SSE progress.
2. `refreshOnce` reads `sync_state.last_msg_ts` from `listings.db`.
3. `fetchMessages(afterTs)` shells out to:
   `wacli-pro messages list -json -limit 100000 -after <ts> -names`.
4. Every returned message is passed to `ParseListing`.
5. `ParseListing` classifies and extracts fields, returns a `Listing`.
6. All listings are inserted in a single transaction (`INSERT OR REPLACE`).
7. If any message had a newer timestamp, `sync_state` is advanced to it.

First run: `last_msg_ts = 0`, so everything wacli has gets parsed. Every
subsequent run: only new messages. That's why the second refresh is
instant and the first one isn't.

**Never use keyword search.** It was tried and abandoned — it missed verb
forms like "arrendo" that don't contain "arrendar" as a substring. The
time-window approach catches everything.

--

## Parser

`parser.go` is the heart of the app. It turns a raw message string into a
`Listing` struct.

### Classification

`classify()` decides the category in strict priority order:

1. **Seeker verbs win outright** — `procuro`, `preciso de`,
   `estou à procura`, `quem tem`, `alguém sabe`. A seeker post is a seeker
   post even if it mentions a rental verb later.
2. **Sale verbs** — `vende-se`, `vendo`, `à venda`.
3. **Rental verbs** — `arrenda-se`, `aluga-se`, `arrendo`, `alugo`,
   `para arrendar`, etc.
4. **Structural fallback** — typology + price, labeled `rental`.
5. Otherwise `noise`.

Note: `\b` is ASCII-only in Go's regexp, so patterns involving accented
characters (`à venda`, `está`) cannot use `\b` on the left. That bug once
put "VIVENDA V3 À VENDA" into rentals.

### Field extraction

- **Title** — first non-empty line, capped at 120 chars.
- **Typology** — matched against `reTypology`. Covers `T0`–`T9`, `V2`–`V9`,
  `duplex`, `apartamento`, `vivenda`, `moradia`, `quarto`, `kitnet`,
  `flat`, `loja`, `terreno`, `lote`, `quinta`, etc.
- **Price** — two passes: `rePriceK` for `"50 mil"` / `"450 kz"`,
  `rePriceNum` for `"preço: 450"` / `"renda 230"`.
- **Phone** — 9-digit Angolan pattern, or the sender JID if it's a
  `@s.whatsapp.net` (never for `@lid`).
- **Location** — see below.

### Location matching

`matchLocation()` tries, in order:

1. Numbered variants first (`Calemba 2` before `Calemba`) — driven by
   the `numberedBases` list.
2. Exact substring of any entry in `knownLocations`.
3. Levenshtein similarity scan over 1–3 word windows, threshold 0.80.
   Catches typos like "Camamma" → "Camama".

`extractLocationRaw()` finds a raw location string by searching for
location markers (`localização`, `endereço`, `bairro`, `perto de`, …) and
taking the text after them.

`resolveCoords()` in `geo.go` maps a matched location onto coordinates
via `locationCoords`. The `parentLocation` map rolls numbered variants
onto a base neighborhood so `/api/nearby` doesn't silently drop them.

**Known bug:** `matchLocation` returns the first hit in `knownLocations`
order, not the most specific. A listing mentioning both "Calemba 2" and
"Camama" gets whichever appears first. Deferred.

--

## Database schema

### listings.db

    CREATE TABLE listings (
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

    CREATE TABLE sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_msg_ts INTEGER NOT NULL DEFAULT 0,
        last_msg_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
    );

Indexes on `typology`, `location`, `price`, `timestamp`, `category`.

WAL mode is enabled on startup. `busy_timeout=5000` prevents
`SQLITE_BUSY` errors when the API and refresh run concurrently.

### ~/.wacli-pro/wacli.db (read-only reference)

The `messages` table:

    CREATE TABLE messages (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_jid TEXT NOT NULL,
        chat_name TEXT,
        msg_id TEXT NOT NULL,
        sender_jid TEXT,
        sender_name TEXT,
        ts INTEGER NOT NULL,           - unix seconds
        from_me INTEGER NOT NULL,
        text TEXT,
        display_text TEXT,
        media_type TEXT,               - 'image' | 'video' | ''
        media_caption TEXT,
        filename TEXT,
        mime_type TEXT,
        direct_path TEXT,
        media_key BLOB,
        file_sha256 BLOB,
        file_enc_sha256 BLOB,
        file_length INTEGER,
        local_path TEXT,               - absolute path once downloaded
        downloaded_at INTEGER,
        reaction_to_id TEXT,
        reaction_emoji TEXT,
        revoked INTEGER NOT NULL DEFAULT 0,
        UNIQUE(chat_jid, msg_id)
    );

--

## Media association

Listings rarely have images attached to the listing message itself. The
pattern in these groups is: text post → images follow within seconds,
from the same sender in the same chat.

`imagesForListing()` in `handlers_media.go` implements this:

1. Take the listing's `chat_jid`, `sender_jid`, and `ts`.
2. Scan forward up to 10 minutes in `wacli.db`.
3. Filter to messages where `media_type` is `image` or `video`.
4. Stop early if a message with > 30 chars of text arrives — that's the
   next listing starting.

Returns a `[]MediaRef` with `{msg_id, url, type, mime}`.

**On-demand download:** if a media file's `local_path` is NULL (the daemon
hadn't downloaded it yet), `handleImage` triggers
`wacli-pro media download -chat X -id Y` inline with a 15-second
timeout, then serves the file. Failed attempts are cached in memory for
10 minutes so repeated views don't hammer WhatsApp.

**The lock problem:** `wacli-pro media download` needs exclusive access
to the store, which the daemon normally holds. If the daemon is actively
syncing, downloads fail with `store is locked`. Workaround: stop the
daemon while browsing (`wacli-pro daemon stop`), restart when done. This
limitation disappears with the planned `whatsmeow` migration.

--

## API

All endpoints return JSON. All set `Cache-Control: no-store`.

| Endpoint | Method | Purpose |
| -- | -- | -- |
| `/api/listings` | GET | Filtered, sorted, paginated list |
| `/api/nearby` | GET | Same, sorted by haversine distance |
| `/api/counts` | GET | Per-category totals |
| `/api/sync-status` | GET | Last sync, DB path, port |
| `/api/refresh` | POST | Sync refresh (JSON response) |
| `/api/refresh/stream` | GET | Same, as SSE |
| `/api/parse-audit` | GET | Re-run parser, report mismatches |
| `/api/listing/{msg_id}` | GET | Single listing + media refs |
| `/api/image/{msg_id}` | GET | Stream media file |
| `/api/send` | POST | Send a WhatsApp message |

### Pagination

`/api/listings` and `/api/nearby` accept `page` and `per_page` and return:

    {
      "rows": [...],
      "total": 410,
      "page": 3,
      "per_page": 50,
      "total_pages": 9
    }

Default `per_page` is 50, max is 500. The `total` respects all active
filters.

### Filters

`/api/listings` query params:

| Param | Meaning |
| -- | -- |
| `category` | `rental` \| `seeker` \| `sale` \| `noise` (default: `rental`) |
| `typology` | Exact match (`T3`, `VIVENDA`, …) |
| `location` | Exact match on matched neighborhood |
| `q` | Full-text on `raw_text` and `title` |
| `min_price` / `max_price` | Integer Kz bounds |
| `sort_col` | Whitelisted column |
| `sort_dir` | `asc` \| `desc` |
| `page` / `per_page` | Pagination |

All listings endpoints automatically filter:
- `chat_jid LIKE '%@g.us'` — group chats only, no DMs
- `raw_text IS NOT NULL AND TRIM(raw_text) != ''` — no empty stubs

--

## Frontend

Vanilla JS, no bundler, no framework. Files loaded in order of dependency:

    ui-state.js    sessionStorage persistence, theme helpers
    resize.js      column width drag + localStorage
    map.js         Leaflet map, geosearch, reference point
    lightbox.js    photo/video lightbox with prev/next
    send.js        send-message dialog with templates
    table.js       table rendering + row expansion + pagination
    app.js         state, boot, load, refresh, counts (loads last)

Plus the detail page:

    listing.html   standalone detail page (own inline styles)
    listing.js     fetches /api/listing/{id}, renders, wires prev/next

Frontend is embedded into the binary via `//go:embed web`.

### State persistence

- **sessionStorage** (`uiState`) — tab, sort, filters, current page,
  map open/ref point, scroll position. Survives navigation between the
  main page and detail pages within the same browser tab.
- **localStorage** (`theme`) — light/dark preference. Survives tab close.
- **localStorage** (`listings.colWidths.v1`) — column widths.

### Theme

CSS variables, with `[data-theme="dark"]` overriding the `:root` values.
An inline script in each HTML file's `<head>` reads the theme before CSS
paints, avoiding a flash of light theme.

--

## File layout

    main.go               Bootstrap, DB init, route registration, static file server
    geo.go                parentLocation map, haversineKm, resolveCoords
    handlers_api.go       /api/listings, /api/nearby, /api/sync-status, /api/counts
    handlers_refresh.go   fetchMessages, refreshOnce, /api/refresh[/stream]
    handlers_media.go     initWacliDB, imagesForListing, /api/listing/{id}, /api/image/{id}
    handlers_send.go      /api/send
    handlers_audit.go     /api/parse-audit
    parser.go             ParseListing, classify, matchLocation, extractLocationRaw
    coords.go             locationCoords map (~120 Luanda neighborhoods)

    web/
      index.html          main page markup
      style.css           all CSS
      app.js              shell: state, boot, load, refresh
      table.js            table rendering, row expansion, pagination
      lightbox.js         shared lightbox
      send.js             send dialog
      map.js              Leaflet map
      resize.js           column resize
      ui-state.js         sessionStorage persistence + theme
      listing.html        detail page (standalone, inline styles)
      listing.js          detail page logic

    seed/main.go          dev-data generator (400 fake listings)
    backfill_media.sh     media backfill script
    Makefile              build / run / run-dev / restart / backfill / seed / status

--

## Design decisions

**No framework.** Plain `net/http`, `database/sql`, vanilla JS. The
surface area is small enough that frameworks would add more complexity
than they remove.

**Pure-Go SQLite.** `modernc.org/sqlite` instead of `mattn/go-sqlite3` —
no CGO, which matters for cross-compilation (and later, Android).

**Incremental refresh.** Only parse what's new since the last run. First
run is slow, every subsequent run is fast. Tracked in `sync_state`.

**Two databases.** Don't touch `wacli.db` — it belongs to the daemon.
Write only to `listings.db`. Media files stay in `wacli-pro`'s media
directory, referenced by path.

**go:embed web.** The binary is self-contained; no external file
dependencies at runtime.

--

## Known limitations

1. **lid senders have no phone number.** Modern WhatsApp groups use `@lid`
   JIDs for privacy. The phone number is not recoverable. The `phone`
   field stays empty for those listings. Sending still works (tested with
   `wacli-pro send text -to <lid>`).
2. **Location matching returns first hit, not most specific.** See above.
3. **Some locations aren't in `coords.go`,** so `/api/nearby` returns
   fewer rows than `/api/listings`. Add missing neighborhoods as found.
4. **The `store is locked` issue** between the app and the daemon.
5. **Old media may be gone forever.** WhatsApp purges media after a
   window. `invalid media hmac` errors mean the file no longer exists on
   WhatsApp's servers — unfixable.

--

## Roadmap

- **whatsmeow migration** — replace `wacli-pro` shell-outs with an
  in-process Go WhatsApp client. Eliminates the store-lock issue, makes
  the app self-contained, prerequisite for Android packaging.
- **Collector/reader split** — a "collector" app that owns the WhatsApp
  connection, and a "reader" app that browses a synced copy of the
  listings index. Sync over WhatsApp file attachments to a private group
  — no server, works on WhatsApp-only data plans.
- **Android packaging** — WebToApp or a similar wrapper around the Go
  binary.
- **Media sync** — currently media stays on the collector. Readers would
  see placeholders or thumbnails delivered alongside the DB.