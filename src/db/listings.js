import { db } from "./index.js";
import { resolveCoords, haversineKm } from "../services/geo.js";

const COLS = [
  "msg_id", "chat_name", "chat_jid", "timestamp", "sender", "sender_jid",
  "title", "typology", "price", "price_text", "price_ok", "location",
  "location_raw", "phone", "raw_text", "category",
];
const SORTABLE = new Set(["title", "typology", "price", "location", "timestamp", "chat_name"]);
const BASE = "chat_jid LIKE '%@g.us' AND raw_text IS NOT NULL AND TRIM(raw_text) != ''";

const upsertStmt = db.prepare(
  `INSERT OR REPLACE INTO listings (${COLS.join(",")}) VALUES (${COLS.map((c) => "@" + c).join(",")})`,
);

export function upsertMany(rows) {
  db.exec("BEGIN");
  try {
    for (const r of rows) upsertStmt.run(r);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const upsert = (row) => upsertStmt.run(row);

function buildWhere(f) {
  const where = [BASE, "category = ?"];
  const args = [f.category || "rental"];
  if (f.typology) { where.push("typology = ?"); args.push(f.typology.toUpperCase()); }
  if (f.location) { where.push("location = ?"); args.push(f.location); }
  if (f.minPrice) { where.push("price >= ?"); args.push(f.minPrice); }
  if (f.maxPrice) { where.push("price <= ?"); args.push(f.maxPrice); }
  if (f.onlyPriceOk) where.push("price_ok = 1");
  if (f.q) {
    where.push("(raw_text LIKE ? OR title LIKE ?)");
    args.push(`%${f.q}%`, `%${f.q}%`);
  }
  return { sql: "WHERE " + where.join(" AND "), args };
}

export function queryListings(f) {
  const { sql, args } = buildWhere(f);
  const total = db.prepare(`SELECT COUNT(*) n FROM listings ${sql}`).get(...args).n;
  const totalPages = Math.max(1, Math.ceil(total / f.perPage));
  const page = Math.min(f.page, totalPages);

  const col = SORTABLE.has(f.sortCol) ? f.sortCol : "timestamp";
  const dir = f.sortDir === "asc" ? "ASC" : "DESC";
  const order =
    (col === "price" ? "CASE WHEN price_ok = 1 THEN 0 ELSE 1 END, " : "") +
    `CASE WHEN ${col} IS NULL OR ${col} = '' THEN 1 ELSE 0 END, ${col} ${dir}, timestamp DESC`;

  const rows = db
    .prepare(`SELECT ${COLS.join(",")} FROM listings ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, f.perPage, (page - 1) * f.perPage);
  return { rows, total, page, per_page: f.perPage, total_pages: totalPages };
}

export function queryNearby(f, lat, lng, maxKm) {
  const { sql, args } = buildWhere(f);
  const all = [];
  for (const r of db.prepare(`SELECT ${COLS.join(",")} FROM listings ${sql}`).all(...args)) {
    const c = resolveCoords(r.location, r.location_raw);
    if (!c) continue;
    const distance_km = haversineKm(lat, lng, c[0], c[1]);
    if (maxKm > 0 && distance_km > maxKm) continue;
    all.push({ ...r, distance_km, lat: c[0], lng: c[1] });
  }
  all.sort((a, b) => (b.price_ok === 1) - (a.price_ok === 1) || a.distance_km - b.distance_km);
  const totalPages = Math.max(1, Math.ceil(all.length / f.perPage));
  const page = Math.min(f.page, totalPages);
  return {
    rows: all.slice((page - 1) * f.perPage, page * f.perPage),
    total: all.length, page, per_page: f.perPage, total_pages: totalPages,
  };
}

export const getListing = (id) =>
  db.prepare(`SELECT ${COLS.join(",")} FROM listings WHERE msg_id = ?`).get(id);

export function counts() {
  const out = { rental: 0, seeker: 0, sale: 0, noise: 0, total: 0 };
  for (const r of db.prepare(`SELECT category c, COUNT(*) n FROM listings WHERE ${BASE} GROUP BY category`).all()) {
    out[r.c] = r.n;
    out.total += r.n;
  }
  return out;
}

export function facets(category = "rental") {
  const pick = (col) =>
    db.prepare(`SELECT ${col} v, COUNT(*) n FROM listings WHERE ${BASE} AND category = ? AND ${col} != '' GROUP BY ${col} ORDER BY n DESC LIMIT 40`)
      .all(category).map((r) => r.v);
  return { typologies: pick("typology"), locations: pick("location") };
}

export const lastTimestamp = () =>
  db.prepare("SELECT MAX(timestamp) t FROM listings").get().t || null;
