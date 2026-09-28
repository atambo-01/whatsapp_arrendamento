// Send-message dialog. Works on the main page and the detail page.
// The outgoing message is sent as a quoted reply to the listing so the
// recipient knows which ad is being referenced.

const SEND_TEMPLATES = [
  "Olá! Vi o seu anúncio, ainda está disponível?",
  "Boa tarde, tenho interesse no imóvel. Ainda está livre?",
  "Olá, gostaria de saber mais sobre este imóvel. Ainda está disponível?",
  "Bom dia! Vi o anúncio e tenho interesse. Podemos falar?",
  "Olá, ainda aceita visitas? Gostaria de marcar uma.",
  "Boa tarde, o valor ainda é o mesmo? Tenho interesse.",
  "Olá! Este imóvel ainda está para arrendar?",
  "Bom dia, tenho interesse. Qual é a melhor altura para visitar?",
  "Olá, vi o anúncio. Pode dar-me mais detalhes?",
  "Boa tarde, o imóvel ainda está disponível? Obrigado."
];

let sendTarget = null;

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function openSendDialog(jid, label, msgId, chatJid) {
  if (!jid) {
    showToast('Sem destinatário — o anúncio não tem JID de autor.');
    return;
  }
  sendTarget = {
    jid: jid,
    label: label || jid,
    msgId: msgId || '',
    chatJid: chatJid || ''
  };

  const dlg = document.getElementById('sendDialog');
  const toEl = document.getElementById('sendTo');
  const ta = document.getElementById('sendText');
  const tpl = document.getElementById('sendTemplate');

  toEl.textContent = sendTarget.label;

  tpl.innerHTML = '';
  for (let i = 0; i < SEND_TEMPLATES.length; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = SEND_TEMPLATES[i].slice(0, 50) + (SEND_TEMPLATES[i].length > 50 ? '…' : '');
    tpl.appendChild(opt);
  }
  ta.value = SEND_TEMPLATES[0];

  dlg.classList.add('open');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function closeSendDialog() {
  const dlg = document.getElementById('sendDialog');
  if (dlg) dlg.classList.remove('open');
  sendTarget = null;
}

function onTemplateChange() {
  const tpl = document.getElementById('sendTemplate');
  const ta = document.getElementById('sendText');
  const idx = parseInt(tpl.value, 10);
  if (idx >= 0 && idx < SEND_TEMPLATES.length) {
    ta.value = SEND_TEMPLATES[idx];
    ta.focus();
  }
}

async function sendMessage() {
  if (!sendTarget) return;
  const ta = document.getElementById('sendText');
  const msg = ta.value.trim();
  if (!msg) { showToast('Mensagem vazia.'); return; }

  const sendBtn = document.getElementById('sendBtn');
  const cancelBtn = document.getElementById('sendCancelBtn');
  sendBtn.disabled = true;
  cancelBtn.disabled = true;
  sendBtn.textContent = 'A enviar…';

  try {
    const body = { to: sendTarget.jid, message: msg };
    if (sendTarget.msgId) body.msg_id = sendTarget.msgId;
    if (sendTarget.chatJid) body.chat_jid = sendTarget.chatJid;

    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    showToast('✓ Mensagem enviada.');
    closeSendDialog();
  } catch (e) {
    showToast('✗ Falha ao enviar: ' + e.message);
  } finally {
    sendBtn.disabled = false;
    cancelBtn.disabled = false;
    sendBtn.textContent = 'Enviar';
  }
}

function initSendDialog() {
  const dlg = document.getElementById('sendDialog');
  if (!dlg) return;
  const close = document.getElementById('sendCloseBtn');
  const cancel = document.getElementById('sendCancelBtn');
  const send = document.getElementById('sendBtn');
  const tpl = document.getElementById('sendTemplate');

  if (close) close.addEventListener('click', closeSendDialog);
  if (cancel) cancel.addEventListener('click', closeSendDialog);
  if (send) send.addEventListener('click', sendMessage);
  if (tpl) tpl.addEventListener('change', onTemplateChange);

  document.addEventListener('keydown', function (e) {
    if (!dlg.classList.contains('open')) return;
    if (e.key === 'Escape') closeSendDialog();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendMessage();
  });
}