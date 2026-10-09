// Admin console: sync log + every stored message with the reason for its category.
import { api } from "./api.js";
import { debounce, esc, toast } from "./format.js";

const $ = (id) => document.getElementById(id);
const CATS = { rental: "Arrendamento", sale: "Venda", seeker: "Procura", noise: "Outros" };
let page = 1;
let logTimer;

async function loadLog() {
  try {
    const { lines } = await api.conLog();
    const box = $("consoleLog");
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.textContent = lines.length
      ? lines.map((l) => `${new Date(l.t).toLocaleTimeString("pt-PT")}  ${l.line}`).join("\n")
      : "Ainda sem registos. Carregue em Sincronizar.";
    if (atEnd) box.scrollTop = box.scrollHeight;
  } catch { /* closed or logged out */ }
}

async function loadGroups() {
  const groups = await api.conGroups();
  const sel = $("conGroup");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Todos os grupos (${groups.length})</option>` +
    groups.map((g) => `<option value="${esc(g.chat_jid)}">${esc(g.chat_name)} — ${g.ads}/${g.total} anúncios</option>`).join("");
  sel.value = cur;
}

async function loadMessages({ append = false } = {}) {
  if (!append) page = 1;
  const data = await api.conMessages({ chat_jid: $("conGroup").value, category: $("conCat").value, q: $("conQ").value.trim(), page });
  const html = data.rows.map((r) => `
    <article class="con-msg">
      <div class="con-head">
        <span class="tag ${r.category === "noise" ? "warn" : "accent"}">${CATS[r.category]}</span>
        <b>${esc(r.chat_name)}</b>
        <span class="muted">${esc(r.sender || "")} · ${new Date(r.timestamp).toLocaleString("pt-PT")}</span>
      </div>
      <div class="con-reason">${esc(r.reason)}</div>
      <div class="con-text">${esc(r.raw_text)}</div>
    </article>`).join("");
  $("conList").innerHTML = append ? $("conList").innerHTML + html : html || `<div class="empty">Sem mensagens.</div>`;
  $("conMeta").textContent = `${data.total.toLocaleString("pt-PT")} mensagens`;
  $("conMore").hidden = data.page * data.per_page >= data.total;
}

async function open() {
  const d = $("consoleDialog");
  d.showModal();
  try {
    await Promise.all([loadGroups(), loadMessages(), loadLog()]);
  } catch (e) {
    toast(e.message, true);
  }
  clearInterval(logTimer);
  logTimer = setInterval(loadLog, 3000);
  d.onclose = () => clearInterval(logTimer);
}

export function initConsole() {
  $("consoleBtn").onclick = open;
  document.addEventListener("wa-admin", (e) => { $("consoleBtn").hidden = !e.detail; });
  const reload = () => loadMessages().catch((e) => toast(e.message, true));
  $("conGroup").onchange = reload;
  $("conCat").onchange = reload;
  $("conQ").oninput = debounce(reload);
  $("conMore").onclick = () => { page++; loadMessages({ append: true }).catch((e) => toast(e.message, true)); };
  // New data after a sync: refresh the open console.
  document.addEventListener("wa-state", () => { if ($("consoleDialog").open) loadGroups().catch(() => {}); });
}
