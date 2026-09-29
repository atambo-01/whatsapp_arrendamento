// Main page shell: state, boot, load, sync status, refresh, counts.
// Table rendering lives in table.js, lightbox/media in lightbox.js,
// state persistence in ui-state.js, map in map.js.

// ---------- State ----------

let timer;
let currentCat = 'rental';
let sortCol = 'timestamp';
let sortDir = 'desc';
let currentPage = 1;
let perPage = 50;

// ---------- Helpers ----------

function debounceLoad() {
  clearTimeout(timer);
  timer = setTimeout(function () {
    uiStateCaptureInputs();
    currentPage = 1;
    uiStateSave({ currentPage: 1 });
    load();
  }, 300);
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}

function titleOr(s, fallback) {
  const t = (s || '').trim();
  return t ? esc(t) : '<span class="placeholder">' + fallback + '</span>';
}

function fmtDistance(km) {
  if (km == null) return '';
  if (km < 1) return (km * 1000).toFixed(0) + ' m';
  return km.toFixed(1) + ' km';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- Tabs / sort ----------

function setCat(cat) {
  currentCat = cat;
  currentPage = 1;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
  uiStateSave({ currentCat: cat, currentPage: 1 });
  load();
}

function setSort(col) {
  if (refLatLng) return;
  if (sortCol === col) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortCol = col;
    sortDir = 'asc';
  }
  currentPage = 1;
  syncDropdown();
  uiStateSave({ sortCol: sortCol, sortDir: sortDir, currentPage: 1 });
  load();
}

function syncDropdown() {
  const sel = document.getElementById('sortBy');
  const target = sortCol + '|' + sortDir;
  if ([...sel.options].some(o => o.value === target)) {
    sel.value = target;
  } else {
    sel.value = '';
  }
}

function onDropdownChange() {
  if (refLatLng) { syncDropdown(); return; }
  const val = document.getElementById('sortBy').value;
  if (!val) return;
  const parts = val.split('|');
  sortCol = parts[0];
  sortDir = parts[1];
  currentPage = 1;
  uiStateSave({ sortCol: sortCol, sortDir: sortDir, currentPage: 1 });
  load();
}

// ---------- Pagination ----------

function gotoPage(p) {
  if (p < 1) p = 1;
  currentPage = p;
  uiStateSave({ currentPage: p });
  load();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Load ----------

async function load() {
  if (refLatLng) {
    const params = new URLSearchParams();
    params.set('lat', refLatLng.lat);
    params.set('lng', refLatLng.lng);
    params.set('category', currentCat);
    params.set('page', currentPage);
    params.set('per_page', perPage);
    const t = document.getElementById('typology').value;
    if (t) params.set('typology', t);
    const res = await fetch('/api/nearby?' + params.toString());
    const data = await res.json();
    renderTable(data, { proximity: true });
    return;
  }

  const params = new URLSearchParams();
  params.set('category', currentCat);
  params.set('sort_col', sortCol);
  params.set('sort_dir', sortDir);
  params.set('page', currentPage);
  params.set('per_page', perPage);
  const q = document.getElementById('q').value;
  const t = document.getElementById('typology').value;
  const mn = document.getElementById('minPrice').value;
  const mx = document.getElementById('maxPrice').value;
  if (q) params.set('q', q);
  if (t) params.set('typology', t);
  if (mn) params.set('min_price', mn);
  if (mx) params.set('max_price', mx);

  const res = await fetch('/api/listings?' + params.toString());
  const data = await res.json();
  renderTable(data);
}

// ---------- Counts ----------

async function loadCounts() {
  try {
    const res = await fetch('/api/counts');
    window.__counts = await res.json();
  } catch (e) {
    window.__counts = {};
  }
}

// ---------- Sync status ----------

async function loadSyncStatus() {
  const el = document.getElementById('syncStatus');
  try {
    const res = await fetch('/api/sync-status');
    const data = await res.json();
    if (data.LAST_SYNC) {
      const last = new Date(data.LAST_SYNC);
      const mins = Math.floor((Date.now() - last.getTime()) / 60000);
      let label;
      if (mins < 1) label = 'just now';
      else if (mins < 60) label = mins + 'm ago';
      else if (mins < 1440) label = Math.floor(mins / 60) + 'h ago';
      else label = Math.floor(mins / 1440) + 'd ago';
      el.textContent = 'Sync: ' + label;
      el.title = 'Last sync: ' + data.LAST_SYNC +
                 ' | DB: ' + (data.DB_PATH || '?') +
                 ' | Port: ' + (data.PORT || '?');
    } else if (data.error) {
      el.textContent = 'Sync: offline';
      el.title = data.error;
    } else {
      el.textContent = 'Sync: unknown';
    }
  } catch (e) {
    el.textContent = 'Sync: error';
  }
}

// ---------- Refresh (SSE) ----------

async function refresh() {
  const btn = document.getElementById('refreshBtn');
  const wrap = document.getElementById('progress');
  const label = document.getElementById('progressLabel');
  const fill = document.getElementById('barFill');

  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  wrap.classList.add('active');
  label.textContent = 'Connecting…';
  fill.style.width = '0%';

  try {
    await new Promise(function(resolve, reject) {
      fetch('/api/refresh/stream').then(function(resp) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function pump() {
          reader.read().then(function(result) {
            if (result.done) { resolve(); return; }
            buffer += decoder.decode(result.value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (let p = 0; p < parts.length; p++) {
              const line = parts[p].split('\n').find(function(l) { return l.startsWith('data: '); });
              if (!line) continue;
              const ev = JSON.parse(line.slice(6));
              handleEvent(ev);
              if (ev.type === 'done') { resolve(); return; }
            }
            pump();
          }).catch(reject);
        }
        pump();
      }).catch(reject);
    });

    await loadCounts();
    await load();
    await loadSyncStatus();
    label.textContent = 'Done';
    setTimeout(function() {
      wrap.classList.remove('active');
      btn.textContent = 'Refresh from WhatsApp';
      btn.disabled = false;
    }, 1500);
  } catch (e) {
    label.textContent = 'Error: ' + e;
    btn.textContent = 'Refresh from WhatsApp';
    btn.disabled = false;
  }

  function handleEvent(ev) {
    const c = ev.counts || {};
    if (ev.type === 'start') {
      label.textContent = '0/' + ev.total + ' — starting…';
      fill.style.width = '0%';
    } else if (ev.type === 'step') {
      label.textContent = (ev.index + 1) + '/' + ev.total + ' — searching "' + ev.keyword + '"…';
    } else if (ev.type === 'step_done') {
      const pct = ((ev.index + 1) / ev.total) * 100;
      fill.style.width = pct + '%';
      label.textContent = (ev.index + 1) + '/' + ev.total +
        ' — rentals:' + (c.rental||0) + ' seek:' + (c.seeker||0) +
        ' sale:' + (c.sale||0) + ' noise:' + (c.noise||0);
    } else if (ev.type === 'done') {
      fill.style.width = '100%';
      label.textContent = 'Done — rentals:' + (c.rental||0) +
        ' seek:' + (c.seeker||0) + ' sale:' + (c.sale||0) +
        ' noise:' + (c.noise||0);
    }
  }
}

// ---------- Boot ----------

(async function() {
  themeInit();
  loadColumnWidths();
  wireGeoSearch();
  initLightbox();

  const saved = uiStateApplyToGlobals();
  uiStateRestoreInputs();
  uiStateRestoreTabs();
  syncDropdown();

  if (typeof restoreMapState === 'function') {
    restoreMapState(saved);
  }

  loadSyncStatus();
  setInterval(loadSyncStatus, 60000);
  await loadCounts();
  try {
    const res = await fetch('/api/listings?category=rental&page=1&per_page=1');
    const data = await res.json();
    if (!data.rows || data.rows.length === 0) {
      refresh();
    } else {
      await load();
      uiStateRestoreScroll();
    }
  } catch (e) {
    await load();
    uiStateRestoreScroll();
  }
})();