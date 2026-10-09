const json = async (url, opts) => {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
  return data;
};
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null && v !== false)).toString();
const post = (url, body) =>
  json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

export const api = {
  listings: (p) => json("/api/listings?" + qs(p)),
  nearby: (p) => json("/api/nearby?" + qs(p)),
  listing: (id) => json("/api/listing/" + encodeURIComponent(id)),
  counts: () => json("/api/counts"),
  facets: (category) => json("/api/facets?" + qs({ category })),
  me: () => json('/api/admin/me'),
  login: (password) => post('/api/admin/login', { password }),
  adminLogout: () => post('/api/admin/logout'),
  conGroups: () => json('/api/console/groups'),
  conMessages: (p) => json('/api/console/messages?' + qs(p)),
  conLog: () => json('/api/console/log'),
  connect: () => post("/api/whatsapp/connect"),
  sync: () => post("/api/whatsapp/sync"),
  logout: () => post("/api/whatsapp/logout"),
  send: (body) => post("/api/send", body),
};
