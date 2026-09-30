# Jinzo

Find rentals, here.

A tool for extracting, parsing and browsing rental/property listings from
WhatsApp groups in Luanda, Angola.

It pulls messages from your WhatsApp account via [`wacli-pro`](https://github.com/…),
runs them through a Portuguese-language parser to identify rentals, seekers,
sales and noise, stores everything in SQLite, and serves a small web UI for
filtering, searching, and sorting by proximity to any point on a map.

---

## Features

- **Automatic extraction** — searches every listing keyword (`arrendar`,
  `alugar`, `renda`, `plafond`, `vende`, …) across all synced chats.
- **Parser** — pulls title, typology (`T0`–`T5`, `V2`–`V5`, `APARTAMENTO`,
  `MORADIA`, …), price, location, phone, and classifies each message as
  `rental`, `seeker`, `sale`, or `noise`.
- **Fuzzy location matching** — 120+ Luanda neighborhoods with approximate
  coordinates, plus Levenshtein fallback for typos.
- **Map proximity sort** — click anywhere on a Leaflet map (or search a
  landmark via Nominatim) to re-sort listings by distance.
- **Filters** — by typology, price range, free-text search, and category tab.
- **Resizable columns** — drag header edges, widths persist per-browser.
- **Dev seed** — `make seed` generates 400 realistic listings (100 per
  category) with wealth-tier-aware pricing for offline testing.

---

## Project layout

```
main.go               HTTP server bootstrap, DB init, static file handler
geo.go                Coordinate resolution + haversine distance
handlers_api.go       /api/listings, /api/nearby, /api/sync-status, /api/counts
handlers_refresh.go   /api/refresh, /api/refresh/stream (SSE)
handlers_audit.go     /api/parse-audit (classifier diagnostics)
parser.go             Message → Listing (regex + heuristics)
coords.go             Neighborhood → [lat, lng] lookup table

web/
  index.html          Markup + script/style tags
  style.css           All CSS
  resize.js           Column resize + localStorage persistence
  map.js              Leaflet map, geosearch, reference point
  app.js              State, tabs, filters, table, refresh, boot

seed/main.go          Standalone dev-data generator

Makefile              build / run / restart / backfill / seed / status targets
listings.db           Real data (gitignored)
listings.dev.db       Seeded dev data (gitignored)
```

---

## Requirements

- **Go** 1.21+
- **`wacli-pro`** on `$PATH` — the WhatsApp CLI used for message sync and
  history backfill
- **`sqlite3`** CLI (optional, for inspecting the DB)
- A **primary WhatsApp device** to respond to on-demand history requests

---

## Setup

1. **Install and authenticate `wacli-pro`:**

   ```bash
   wacli-pro doctor
   ```

   Follow the auth flow. Once done, `wacli-pro chats list --json --limit 10`
   should list your chats.

2. **Clone and build:**

   ```bash
   git clone <repo>
   cd whatsapp-arrendamento
   make build
   ```

3. **Run the server:**

   ```bash
   make run          # foreground
   # or, if you have a systemd unit:
   make start
   ```

   By default the server binds `:8090` and reads `listings.db`.

4. **Open** http://localhost:8090 and click **Refresh from WhatsApp**.

---

## Environment variables

| Variable       | Default       | Purpose                                  |
| -------------- | ------------- | ---------------------------------------- |
| `LISTINGS_DB`  | `listings.db` | SQLite database path                     |
| `PORT`         | `8090`        | HTTP listen port                         |

Use them to run a dev instance alongside the real one:

```bash
LISTINGS_DB=listings.dev.db PORT=8091 ./listings
```

---

## Makefile targets

Run `make help` for the full list. The commonly used ones:

| Target             | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `make build`       | Build the `listings` binary                             |
| `make run`         | Build then run in foreground                            |
| `make restart`     | Rebuild and restart the systemd user service            |
| `make stop/start`  | Stop / start the service                                |
| `make logs`        | Tail service logs                                       |
| `make status`      | Service state, wacli store stats, DB counts, HTTP check |
| `make seed`        | Generate 400 fake listings into `listings.dev.db`       |
| `make run-dev`     | Build + seed + run against `listings.dev.db`            |
| `make clean-dev`   | Delete `listings.dev.db`                                |
| `make backfill`    | Stop sync, backfill all groups, restart sync            |

---

## Data model

SQLite table `listings`:

| Column         | Type    | Notes                                          |
| -------------- | ------- | ---------------------------------------------- |
| `msg_id`       | TEXT PK | WhatsApp message ID (unique)                   |
| `chat_name`    | TEXT    | Group name                                     |
| `chat_jid`     | TEXT    | Group JID                                      |
| `timestamp`    | TEXT    | RFC3339, UTC                                   |
| `sender`       | TEXT    | Display name of sender                         |
| `sender_jid`   | TEXT    | WhatsApp JID                                   |
| `title`        | TEXT    | First non-empty line, capped at 120 chars      |
| `typology`     | TEXT    | `T2`, `V3`, `APARTAMENTO`, `MORADIA`, …        |
| `price`        | INTEGER | Kz, parsed from `100.000 Kz` / `2 mil`         |
| `price_text`   | TEXT    | Original price string                          |
| `location`     | TEXT    | Matched neighborhood (canonical form)          |
| `location_raw` | TEXT    | Raw location string from the message           |
| `phone`        | TEXT    | Extracted phone number                         |
| `raw_text`     | TEXT    | Full message body                              |
| `category`     | TEXT    | `rental` \| `seeker` \| `sale` \| `noise`      |

Indexes on `typology`, `location`, `price`, `timestamp`, `category`.

---

## API

All endpoints return JSON. All set `Cache-Control: no-store`.

- **`GET /api/listings`** — filtered, sorted list (max 500 rows).
  Query: `category`, `typology`, `location`, `q`, `min_price`, `max_price`,
  `sort_col`, `sort_dir`.
- **`GET /api/nearby`** — same list but sorted by distance.
  Query: `lat`, `lng` (required), `category`, `typology`, `max_km`.
- **`GET /api/counts`** — `{ "rental": N, "seeker": N, …, "total": N }`.
- **`GET /api/sync-status`** — last sync timestamp, DB path, port.
- **`POST /api/refresh`** — run a full search-and-parse refresh synchronously.
- **`GET /api/refresh/stream`** — same, as Server-Sent Events.
- **`GET /api/parse-audit`** — re-runs the parser against every stored row
  and reports rows whose stored category no longer matches the parser's
  verdict. Query: `category`, `limit`. Used to catch classifier regressions.

---

## Backfilling older messages

`wacli-pro` syncs new messages automatically, but old history must be
requested on demand. Use the Makefile target:

```bash
make backfill
```

This stops the sync daemon (which holds the store lock), iterates every
group chat, and calls `wacli-pro history backfill` per chat, then restarts
sync.

To target a single chat:

```bash
make sync-stop
wacli-pro history backfill --chat "<jid>" --requests 10 --count 50 --wait 90s
make sync-start
```

Useful flags: `--requests N` = pages, `--count N` = messages per page,
`--wait 90s` = timeout for the phone to respond. The phone must be online.

---

## Dev workflow

Use the seeded dev DB so your real `listings.db` stays untouched:

```bash
make stop        # stop the real service (frees :8090)
make run-dev     # builds, seeds listings.dev.db, runs in foreground
```

The dev server logs `using database: listings.dev.db` at startup. Hit
Ctrl+C to stop. The seed is deterministic (`-seed 42` by default) so
bug reports are reproducible.

**Do not click "Refresh from WhatsApp" against the dev DB** — it will pull
real messages into your seeded data. If it happens, `make clean-dev &&
make run-dev` resets.

---

## Parser notes

Message → category is decided by `classify()` in `parser.go`, in strict
priority order:

1. **Seeker verbs win outright** — `procuro`, `preciso de`,
   `estou à procura`, `quem tem`, `alguém sabe`. A seeker post is a seeker
   post even if it mentions a rental verb later.
2. **Sale verbs** — `vende-se`, `vendo`, `à venda`.
3. **Rental verbs** — `arrenda-se`, `aluga-se`, `para arrendar`.
4. **Structural fallback** — typology + price, labeled `rental`.
5. Otherwise `noise`.

Location matching is in `matchLocation()`. It tries in order: numbered
variants (`Calemba 2` before `Calemba`), exact substring of any known
neighborhood, then a Levenshtein similarity scan (threshold 0.80).

If you see systematic misclassification, use `/api/parse-audit` to dump
the mismatches and check whether a new opener / spelling should be added
to the `reSeekerVerb`, `reSaleVerb`, or `reRentalVerb` alternations.

---

## Adding a new neighborhood

1. Add the canonical name to `knownLocations` in `parser.go`.
2. Add its coordinates to `locationCoords` in `coords.go`
   (approximate is fine — Nominatim lookup works).
3. If it's a numbered variant (`Calemba 2`), also add:
   - the base name to `numberedBases` in `parser.go`
   - a `"Calemba 2": "Calemba"` entry in `parentLocation` in `geo.go`

Then `make restart` and re-refresh to re-parse existing messages.

---

## Troubleshooting

- **Page loads blank.** Hard-reload (Ctrl+Shift+R) once — you may be
  holding a stale `index.html`. The server sends `Cache-Control: no-store`
  so this should not recur.
- **`address already in use` on startup.** Something is on :8090. Check
  `ss -tlnp | grep 8090`. If it's the systemd service, `make stop` first.
- **`store is locked (another wacli is running?)`** when backfilling.
  Run `make sync-stop` first. The sync daemon holds the store lock.
- **`timed out waiting for on-demand history sync response`.** The phone
  didn't answer in time. Increase `--wait` (e.g. `--wait 120s`) and retry.
- **`/api/nearby` returns fewer rows than `/api/listings`.** Expected —
  proximity mode drops listings whose location isn't in `coords.go`.
  Add the missing neighborhood to fix.

---

## Naming

**Jinzo** is the product name. The codebase, binary, database files, env
vars and storage keys still use the original working name (`listings`,
`LISTINGS_DB`, `listings.db`). This is deliberate — the rename was scoped
to user-facing surfaces only, to avoid churn in tooling, services, and
saved browser state.

When reading the code or running commands, `listings` means Jinzo.

## License

Private / unpublished.