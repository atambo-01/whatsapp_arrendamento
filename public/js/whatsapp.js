// WhatsApp link state: SSE stream, QR dialog, header pill, sync progress.
import { api } from "./api.js";
import { esc, toast } from "./format.js";

export const wa = { state: { status: "idle" }, listeners: new Set() };
const $ = (id) => document.getElementById(id);
const LABEL = {
  disabled: "Sem WhatsApp", idle: "Ligar WhatsApp", starting: "A iniciar…", qr: "Ler QR code",
  authenticated: "A autenticar…", ready: "Ligado", disconnected: "Desligado", error: "Erro",
};
let lastSyncRunning = false;
let autoOpened = false;

export function initWhatsApp({ onSynced }) {
  const es = new EventSource("/api/whatsapp/events");
  es.onmessage = (e) => {
    wa.state = JSON.parse(e.data);
    render();
    if (lastSyncRunning && !wa.state.sync.running) {
      toast(`Sincronização concluída · ${wa.state.sync.saved} mensagens`);
      onSynced?.();
    }
    lastSyncRunning = wa.state.sync.running;
  };
  $("waPill").onclick = () => openDialog();
  $("syncBtn").onclick = () => api.sync().then(() => toast("A sincronizar…")).catch((e) => toast(e.message, true));
  $("waDialog").addEventListener("click", (e) => { if (e.target === $("waDialog")) $("waDialog").close(); });
}

function render() {
  const s = wa.state;
  $("waPill").dataset.s = s.status;
  $("waPillText").textContent = s.status === "ready" && s.me ? `Ligado · ${s.me}` : LABEL[s.status] || s.status;
  $("syncBtn").hidden = s.status !== "ready";
  $("syncBtn").disabled = s.sync.running;

  const bar = $("syncBar");
  bar.hidden = !s.sync.running;
  $("syncFill").style.width = s.sync.total ? `${(s.sync.done / s.sync.total) * 100}%` : "5%";

  // Auto-open the QR dialog the first time a code is available.
  if (s.status === "qr" && !autoOpened) { autoOpened = true; openDialog(); }
  if (s.status === "ready" && $("waDialog").open) renderDialog();
  if ($("waDialog").open) renderDialog();
  document.dispatchEvent(new CustomEvent("wa-state", { detail: s }));
}

function openDialog() {
  const d = $("waDialog");
  if (!d.open) d.showModal();
  renderDialog();
  if (["idle", "disconnected", "error"].includes(wa.state.status)) api.connect().catch((e) => toast(e.message, true));
}

function renderDialog() {
  const s = wa.state;
  const body = $("waBody");
  const close = `<button class="btn btn-ghost" onclick="this.closest('dialog').close()">Fechar</button>`;
  let html;
  if (s.status === "qr" && s.qr) {
    html = `<h2>Ligar ao WhatsApp</h2>
      <div class="qr-wrap"><img alt="QR code" src="${s.qr}"></div>
      <ol class="steps"><li>Abra o WhatsApp no telemóvel</li><li>Dispositivos ligados → <b>Ligar um dispositivo</b></li><li>Aponte a câmara para este código</li></ol>
      <div class="dialog-actions">${close}</div>`;
  } else if (s.status === "ready") {
    html = `<h2>WhatsApp ligado ✓</h2>
      <p class="muted">Conta: <b>${esc(s.me || "—")}</b>. Os anúncios dos seus grupos são lidos automaticamente.</p>
      <div class="dialog-actions"><button class="btn" id="waOut">Terminar sessão</button>${close}</div>`;
  } else if (["error", "disconnected"].includes(s.status)) {
    html = `<h2>${s.status === "error" ? "Algo correu mal" : "Sessão terminada"}</h2>
      <p class="muted">${esc(s.error || "A ligação foi perdida.")}</p>
      <div class="dialog-actions"><button class="btn btn-primary" id="waRetry">Tentar novamente</button>${close}</div>`;
  } else if (s.status === "disabled") {
    html = `<h2>WhatsApp desativado</h2><p class="muted">O servidor foi iniciado com <code>WA_DISABLED=1</code>. A mostrar apenas os dados guardados.</p><div class="dialog-actions">${close}</div>`;
  } else {
    html = `<h2>A preparar a ligação…</h2><div style="display:grid;place-items:center;padding:20px"><div class="spinner"></div></div>
      <p class="muted" style="text-align:center;margin:0">Na primeira vez pode demorar alguns segundos.</p><div class="dialog-actions">${close}</div>`;
  }
  body.innerHTML = html;
  body.querySelector("#waOut")?.addEventListener("click", () => api.logout().then(() => toast("Sessão terminada")));
  body.querySelector("#waRetry")?.addEventListener("click", () => api.connect());
}
