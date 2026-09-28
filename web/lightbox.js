// Lightbox: open a photo/video, browse with arrow keys, close with Esc.
// Shared between the main listings page and the detail page.

let LB_LIST = [];      // [{url, type, msg_id}, ...]
let LB_INDEX = -1;

function initLightbox() {
  const lb = document.getElementById('lightbox');
  const close = document.getElementById('lightbox-close');
  if (!lb) return;
  close.addEventListener('click', closeLightbox);
  lb.addEventListener('click', function (e) {
    if (e.target === lb) closeLightbox();
  });
}

// Called as openLightbox(msgId, index) from the main table panel, or
// openLightbox(list, index) directly.
function openLightbox(msgIdOrList, index) {
  if (Array.isArray(msgIdOrList)) {
    LB_LIST = msgIdOrList;
  } else {
    LB_LIST = MEDIA_CACHE[msgIdOrList] || [];
  }
  LB_INDEX = index;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
}

function renderLightbox() {
  const content = document.getElementById('lightbox-content');
  if (LB_INDEX < 0 || LB_INDEX >= LB_LIST.length) {
    content.innerHTML = '';
    return;
  }
  const m = LB_LIST[LB_INDEX];
  const prev = LB_INDEX > 0 ? '<button class="lb-nav lb-prev" onclick="lbStep(-1)">‹</button>' : '';
  const next = LB_INDEX < LB_LIST.length - 1 ? '<button class="lb-nav lb-next" onclick="lbStep(1)">›</button>' : '';
  const counter = LB_LIST.length > 1
    ? '<div class="lb-counter">' + (LB_INDEX + 1) + ' / ' + LB_LIST.length + '</div>'
    : '';

  let inner;
  if (m.type === 'video') {
    inner = '<video src="' + esc(m.url) + '" controls autoplay></video>';
  } else {
    inner = '<img src="' + esc(m.url) + '" alt="">';
  }

  content.innerHTML = prev + inner + next + counter;
}

function lbStep(delta) {
  const n = LB_INDEX + delta;
  if (n < 0 || n >= LB_LIST.length) return;
  LB_INDEX = n;
  renderLightbox();
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.classList.remove('open');
  document.getElementById('lightbox-content').innerHTML = '';
  LB_LIST = [];
  LB_INDEX = -1;
}

// Global keyboard: Esc closes, ← / → step within the lightbox when open.
// Outside the lightbox, ← / → are ignored here (detail page wires its own
// listing navigation in listing.js).
document.addEventListener('keydown', function (e) {
  const lb = document.getElementById('lightbox');
  if (!lb || !lb.classList.contains('open')) return;
  if (e.key === 'Escape') { closeLightbox(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); lbStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); lbStep(1); }
});