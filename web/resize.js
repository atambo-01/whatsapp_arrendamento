// ---------- Column widths ----------
// Persisted in localStorage under COL_WIDTHS_KEY. `colWidths` is a map of
// column key -> pixel width. Columns without an entry fall back to
// DEFAULT_WIDTHS, then to a 140px generic default.

const COL_WIDTHS_KEY = 'listings.colWidths.v1';

const DEFAULT_WIDTHS = {
  'row-num':  50,
  'title':    380,
  'distance': 100,
  'typology': 110,
  'price':    130,
  'location': 200,
  'phone':    140,
  'timestamp':110,
  'chat_name':200,
  'actions':  130,
};

let colWidths = {};

function loadColumnWidths() {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    colWidths = raw ? JSON.parse(raw) : {};
  } catch (e) {
    colWidths = {};
  }
}

function saveColumnWidths() {
  try {
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
  } catch (e) { /* ignore */ }
}

function widthFor(colKey) {
  if (colWidths[colKey] != null) return colWidths[colKey];
  if (DEFAULT_WIDTHS[colKey] != null) return DEFAULT_WIDTHS[colKey];
  return 140;
}

function resetColumnWidths() {
  colWidths = {};
  saveColumnWidths();
  load();
}

function applyWidths() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const key = th.dataset.col;
    th.style.width = widthFor(key) + 'px';
    th.style.minWidth = widthFor(key) + 'px';
  });
}

// attachResizers wires drag handles onto every resizable <th>. Called after
// each render(). Safe to call multiple times — it skips headers that already
// have a handle.
function attachResizers() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    if (th.querySelector('.resizer')) return;
    const handle = document.createElement('div');
    handle.className = 'resizer';
    handle.addEventListener('mousedown', startResize);
    handle.addEventListener('touchstart', startResize, { passive: false });
    th.appendChild(handle);
  });
  applyWidths();
}

function startResize(e) {
  e.preventDefault();
  e.stopPropagation();

  const handle = e.currentTarget;
  const th = handle.parentElement;
  const colKey = th.dataset.col;
  if (!colKey) return;

  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const startX = e.touches ? e.touches[0].clientX : e.clientX;
  const startWidth = th.getBoundingClientRect().width;

  function onMove(ev) {
    const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const delta = x - startX;
    const newWidth = Math.max(40, Math.min(1000, startWidth + delta));
    th.style.width = newWidth + 'px';
    th.style.minWidth = newWidth + 'px';
  }

  function onUp() {
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const finalWidth = th.getBoundingClientRect().width;
    colWidths[colKey] = Math.round(finalWidth);
    saveColumnWidths();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}