import { Router } from "express";
import {
  counts, facets, getListing, lastTimestamp, queryListings, queryNearby,
} from "../db/listings.js";
import { isAdmin, requireAdmin } from "../auth.js";
import { whatsapp } from "../whatsapp/client.js";

const int = (v, d = 0) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

function filtersFrom(q) {
  return {
    category: ["rental", "seeker", "sale", "noise"].includes(q.category) ? q.category : "rental",
    typology: q.typology || "",
    location: q.location || "",
    minPrice: int(q.min_price) || 0,
    maxPrice: int(q.max_price) || 0,
    onlyPriceOk: q.only_price_ok === "1",
    q: (q.q || "").trim(),
    page: Math.max(1, int(q.page, 1)),
    perPage: Math.min(200, Math.max(1, int(q.per_page, 30))),
    sortCol: q.sort_col || "timestamp",
    sortDir: q.sort_dir === "asc" ? "asc" : "desc",
  };
}

export const api = Router();

api.get("/listings", (req, res) => res.json(queryListings(filtersFrom(req.query))));

api.get("/nearby", (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: "lat/lng required" });
  res.json(queryNearby(filtersFrom(req.query), lat, lng, parseFloat(req.query.max_km) || 0));
});

api.get("/listing/:id", (req, res) => {
  const row = getListing(req.params.id);
  row ? res.json(row) : res.status(404).json({ error: "not found" });
});

api.get("/counts", (_req, res) => res.json(counts()));
api.get("/facets", (req, res) => res.json(facets(req.query.category || "rental")));
api.get("/last-sync", (_req, res) => res.json({ last: lastTimestamp() }));

// ---- WhatsApp ----
// The QR code is only ever sent to an authenticated admin.
const view = (req, s) => (isAdmin(req) ? s : { ...s, qr: null, error: null, me: null });

api.get("/whatsapp/state", (req, res) => res.json(view(req, whatsapp.snapshot())));

api.get("/whatsapp/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const push = (s) => res.write(`data: ${JSON.stringify(view(req, s))}\n\n`);
  push(whatsapp.snapshot());
  whatsapp.on("state", push);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); whatsapp.off("state", push); });
});

api.post("/whatsapp/connect", requireAdmin, (_req, res) => { whatsapp.start(); res.json({ ok: true }); });
api.post("/whatsapp/sync", requireAdmin, (_req, res) => {
  if (whatsapp.snapshot().status !== "ready") return res.status(409).json({ ok: false, error: "WhatsApp não está ligado" });
  whatsapp.sync().catch((e) => console.error("[wa] sync failed:", e.stack || e.message));
  res.json({ ok: true });
});
api.post("/whatsapp/logout", requireAdmin, async (_req, res) => { await whatsapp.logout(); res.json({ ok: true }); });

api.post("/send", requireAdmin, async (req, res) => {
  const { chat_jid, message, msg_id } = req.body || {};
  if (!chat_jid || !message?.trim()) return res.status(400).json({ ok: false, error: "Mensagem em falta" });
  try {
    await whatsapp.send(chat_jid, message.trim(), msg_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
