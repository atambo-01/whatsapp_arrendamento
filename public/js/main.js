import { api } from "./api.js";
import { ago, debounce, esc, kz, toast, waLink } from "./format.js";
import { bindGeosearch, clearRef, drawRadius, initMap, invalidate, setRef } from "./map.js";
import { initWhatsApp, wa } from "./whatsapp.js";

const $ = (id) => document.getElementById(id);
const CATS = { rental: "Arrendamento", sale: "Venda", seeker: "Procura", noise: "Outros" };
const TEMPLATES = [
  { name: "Tenho interesse", text: "Olá! Vi o seu anúncio e tenho interesse. Ainda está disponível?" },
  { name: "Pedir visita", text: "Boa tarde! Gostaria de agendar uma visita. Que dias e horas tem disponíveis?" },
  { name: "Pedir fotos", text: "Olá! Poderia enviar mais fotos e confirmar o valor da renda?" },
  { name: "Em branco", text: "" },
];

// ---- State (mirrored in the URL so views are shareable) ----
const state = {
  category: "rental", q: "", typology: "", location: "", minPrice: "", maxPrice: "",
  onlyOk: false, sort: "timestamp|desc", page: 1, ref: null, radius: 0, map: false,
};
const KEYS = { category: "c", q: "q", typology: "t", location: "l", minPrice: "min", maxPrice: "max", sort: "s", page: "p" };

function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const [k, u] of Object.entries(KEYS)) if (p.has(u)) state[k] = k === "page" ? +p.get(u) || 1 : p.get(u);
  state.onlyOk = p.get("ok") === "1";
}
function writeUrl() {
  const p = new URLSearchParams();
  for (const [k, u] of Object.entries(KEYS)) if (state[k] && !(k === "page" && state.page === 1)) p.set(u, state[k]);
  if (state.onlyOk) p.set("ok", "1");
  history.replaceState(null, "", p.size ? "?" + p : location.pathname);
}

// ---- Data loading ----
let loadSeq = 0;
async function load({ resetPage = false } = {}) {
  if (resetPage) state.page = 1;
  writeUrl();
  const seq = ++loadSeq;
  const list = $("list");
  list.setAttribute("aria-busy", "true");
  if (!list.children.length) list.innerHTML = '<div class="skeleton"></div>'.repeat(4);

  const [col, dir] = state.sort.split("|");
  const params = {
    category: state.category, q: state.q, typology: state.typology, location: state.location,
    min_price: state.minPrice, max_price: state.maxPrice, only_price_ok: state.onlyOk ? 1 : "",
    page: state.page, per_page: 20, sort_col: col, sort_dir: dir,
  };
  try {
    const data = state.ref
      ? await api.nearby({ ...params, lat: state.ref.lat, lng: state.ref.lng, max_km: state.radius || "" })
      : await api.listings(params);
    if (seq !== loadSeq) return;
    renderList(data);
  } catch (e) {
    if (seq === loadSeq) list.innerHTML = `<div class="empty"><div class="big">⚠️</div><h3>Não foi possível carregar</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

const rows = new Map();
function renderList(data) {
  rows.clear();
  data.rows.forEach((r) => rows.set(r.msg_id, r));
  $("resultCount").textContent =
    `${data.total.toLocaleString("pt-PT")} resultado${data.total === 1 ? "" : "s"}` +
    (state.ref ? ` · ordenado por proximidade a “${state.ref.label}”` : "");

  $("list").innerHTML = data.rows.length
    ? data.rows.map(cardHtml).join("")
    : `<div class="empty"><div class="big">🔎</div><h3>Nada encontrado</h3>
       <p>${hasFilters() ? "Experimente remover alguns filtros." : wa.state.status === "ready" ? "Ainda sem anúncios — use Sincronizar." : "Ligue o WhatsApp para importar os anúncios dos seus grupos."}</p>
       ${hasFilters() ? '<button class="btn" id="resetFilters">Limpar filtros</button>' : ""}</div>`;
  renderPager(data);
}

const hasFilters = () => state.q || state.typology || state.location || state.minPrice || state.maxPrice || state.onlyOk || state.ref;

function cardHtml(r) {
  const price = r.price_ok === 1 || (r.price && r.category !== "noise")
    ? `<div class="card-price">${kz(r.price)}${r.category === "rental" ? "<small>por mês</small>" : ""}</div>`
    : `<div class="card-price dim">Preço n/d</div>`;
  const where = r.location || r.location_raw;
  return `<button class="card" data-id="${esc(r.msg_id)}">
    <div class="card-title">${esc(r.title || r.raw_text.slice(0, 100))}</div>
    ${price}
    <div class="card-meta">
      ${r.typology ? `<span class="tag accent">${esc(r.typology)}</span>` : ""}
      ${where ? `<span class="tag">📍 ${esc(where.length > 36 ? where.slice(0, 36) + "…" : where)}</span>` : ""}
      ${r.distance_km != null ? `<span class="tag">${r.distance_km.toFixed(1)} km</span>` : ""}
      ${r.price && r.price_ok === 0 ? `<span class="tag warn" title="Valor fora do intervalo habitual">preço duvidoso</span>` : ""}
      <span class="sep">•</span><span>${esc(r.chat_name)}</span>
      <span class="sep">•</span><span>${ago(r.timestamp)}</span>
    </div></button>`;
}

function renderPager({ page, total_pages: n }) {
  const pager = $("pager");
  if (n <= 1) return (pager.innerHTML = "");
  const nums = [...new Set([1, page - 1, page, page + 1, n])].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b);
  let html = `<button class="btn" data-p="${page - 1}" ${page === 1 ? "disabled" : ""}>←</button>`;
  nums.forEach((x, i) => {
    if (i && x - nums[i - 1] > 1) html += `<span class="muted">…</span>`;
    html += `<button class="btn ${x === page ? "btn-primary" : ""}" data-p="${x}">${x}</button>`;
  });
  pager.innerHTML = html + `<button class="btn" data-p="${page + 1}" ${page === n ? "disabled" : ""}>→</button>`;
}

async function loadMeta() {
  const [counts, facets] = await Promise.all([api.counts(), api.facets(state.category)]);
  document.querySelectorAll(".tab").forEach((t) => {
    t.setAttribute("aria-selected", t.dataset.cat === state.category);
    t.querySelector("b").textContent = counts[t.dataset.cat] ?? 0;
  });
  $("chips").innerHTML = facets.typologies
    .slice(0, 12)
    .map((t) => `<button class="chip" data-t="${esc(t)}" aria-pressed="${state.typology === t}">${esc(t)}</button>`)
    .join("");
  const sel = $("location");
  sel.innerHTML = `<option value="">Todas as zonas</option>` +
    facets.locations.map((l) => `<option ${l === state.location ? "selected" : ""}>${esc(l)}</option>`).join("");
}

// ---- Drawer ----
function openDrawer(id) {
  const r = rows.get(id);
  if (!r) return;
  const link = waLink(r.phone, `Olá! Vi o anúncio "${r.title}" e tenho interesse.`);
  $("drawerBody").innerHTML = `
    <span class="tag accent">${CATS[r.category]}</span>
    <h2>${esc(r.title || "Anúncio")}</h2>
    ${r.price ? `<div class="price">${kz(r.price)}${r.category === "rental" ? ' <small class="muted" style="font-size:14px;font-weight:500">/ mês</small>' : ""}</div>` : ""}
    <dl class="facts">
      ${r.typology ? `<dt>Tipologia</dt><dd>${esc(r.typology)}</dd>` : ""}
      <dt>Zona</dt><dd>${esc(r.location || r.location_raw || "—")}</dd>
      <dt>Contacto</dt><dd>${esc(r.phone || "—")}</dd>
      <dt>Grupo</dt><dd>${esc(r.chat_name)}</dd>
      <dt>Enviado por</dt><dd>${esc(r.sender || "—")}</dd>
      <dt>Data</dt><dd>${new Date(r.timestamp).toLocaleString("pt-PT")}</dd>
    </dl>
    <div class="raw">${esc(r.raw_text)}</div>
    <div class="actions">
      ${link ? `<a class="btn btn-primary" target="_blank" rel="noopener" href="${link}">Abrir no WhatsApp</a>` : ""}
      <button class="btn" id="replyBtn" ${wa.state.status === "ready" ? "" : "disabled title='Ligue o WhatsApp primeiro'"}>Responder no grupo</button>
      <button class="btn btn-ghost" id="copyBtn">Copiar texto</button>
    </div>`;
  const d = $("drawer");
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  $("replyBtn").onclick = () => openSend(r);
  $("copyBtn").onclick = () => navigator.clipboard.writeText(r.raw_text).then(() => toast("Texto copiado"));
  history.replaceState(null, "", `/listing/${encodeURIComponent(id)}${location.search}`);
}
function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  if (location.pathname.startsWith("/listing/")) history.replaceState(null, "", "/" + location.search);
}

function openSend(r) {
  const dlg = $("sendDialog");
  $("sendTo").textContent = `Resposta ao anúncio em “${r.chat_name}”`;
  $("sendTpl").innerHTML = TEMPLATES.map((t, i) => `<option value="${i}">${t.name}</option>`).join("");
  $("sendText").value = TEMPLATES[0].text;
  $("sendTpl").onchange = () => ($("sendText").value = TEMPLATES[$("sendTpl").value].text);
  dlg.returnValue = "";
  dlg.onclose = async () => {
    if (dlg.returnValue !== "send" || !$("sendText").value.trim()) return;
    try {
      await api.send({ chat_jid: r.chat_jid, msg_id: r.msg_id, message: $("sendText").value });
      toast("Mensagem enviada ✓");
    } catch (e) { toast(e.message, true); }
  };
  dlg.showModal();
  $("sendText").focus();
}

// ---- Wiring ----
function bind() {
  $("tabs").onclick = (e) => {
    const t = e.target.closest(".tab");
    if (!t || t.dataset.cat === state.category) return;
    Object.assign(state, { category: t.dataset.cat, typology: "", location: "" });
    loadMeta().then(() => load({ resetPage: true }));
  };
  const text = debounce(() => load({ resetPage: true }));
  $("q").oninput = (e) => { state.q = e.target.value.trim(); text(); };
  $("minPrice").oninput = (e) => { state.minPrice = e.target.value; text(); };
  $("maxPrice").oninput = (e) => { state.maxPrice = e.target.value; text(); };
  $("location").onchange = (e) => { state.location = e.target.value; load({ resetPage: true }); };
  $("sort").onchange = (e) => { state.sort = e.target.value; load({ resetPage: true }); };
  $("onlyOk").onchange = (e) => { state.onlyOk = e.target.checked; load({ resetPage: true }); };
  $("chips").onclick = (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    state.typology = state.typology === c.dataset.t ? "" : c.dataset.t;
    document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.t === state.typology));
    load({ resetPage: true });
  };
  $("list").onclick = (e) => {
    const c = e.target.closest(".card");
    if (c) return openDrawer(c.dataset.id);
    if (e.target.id === "resetFilters") resetFilters();
  };
  $("pager").onclick = (e) => {
    const b = e.target.closest("[data-p]");
    if (!b || b.disabled) return;
    state.page = +b.dataset.p;
    load().then(() => scrollTo({ top: 0, behavior: "smooth" }));
  };
  document.querySelectorAll("[data-close]").forEach((el) => (el.onclick = closeDrawer));

  $("themeBtn").onclick = () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    localStorage.setItem("theme", t);
  };

  // Map
  $("mapBtn").onclick = () => {
    state.map = !state.map;
    $("mapPanel").hidden = !state.map;
    $("mapBtn").setAttribute("aria-pressed", state.map);
    if (state.map) { ensureMap(); invalidate(); }
  };
  $("radius").onchange = (e) => {
    state.radius = +e.target.value;
    if (state.ref) { drawRadius(state.ref.lat, state.ref.lng, state.radius); load({ resetPage: true }); }
  };
  $("clearRef").onclick = () => {
    state.ref = null;
    clearRef();
    $("refText").textContent = "Toque no mapa para ordenar por proximidade.";
    $("clearRef").hidden = true;
    load({ resetPage: true });
  };

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); $("q").focus(); }
    if (e.key === "Escape") closeDrawer();
  });
  document.addEventListener("wa-state", () => $("drawer").classList.contains("open") || null);
}

let mapReady = false;
function ensureMap() {
  if (mapReady) return;
  mapReady = true;
  initMap($("map"), ({ lat, lng, label }) => {
    state.ref = { lat, lng, label };
    $("refText").textContent = `Referência: ${label}`;
    $("clearRef").hidden = false;
    drawRadius(lat, lng, state.radius);
    load({ resetPage: true });
  });
  bindGeosearch($("geoQ"), $("geoResults"));
}

function resetFilters() {
  Object.assign(state, { q: "", typology: "", location: "", minPrice: "", maxPrice: "", onlyOk: false });
  syncInputs();
  $("clearRef").onclick();
  loadMeta().then(() => load({ resetPage: true }));
}

function syncInputs() {
  $("q").value = state.q; $("minPrice").value = state.minPrice; $("maxPrice").value = state.maxPrice;
  $("onlyOk").checked = state.onlyOk; $("sort").value = state.sort;
}

// ---- Boot ----
readUrl();
syncInputs();
bind();
initWhatsApp({ onSynced: () => loadMeta().then(() => load()) });
await loadMeta();
await load();
const m = location.pathname.match(/^\/listing\/(.+)/);
if (m) {
  const id = decodeURIComponent(m[1]);
  if (!rows.has(id)) api.listing(id).then((r) => { rows.set(id, r); openDrawer(id); }).catch(() => toast("Anúncio não encontrado", true));
  else openDrawer(id);
}
