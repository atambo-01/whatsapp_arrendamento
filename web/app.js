// ---------- State ----------

let timer;
let currentCat = 'rental';
let sortCol = 'timestamp';
let sortDir = 'desc';

// ---------- Helpers ----------

function debounceLoad() { clearTimeout(timer); timer = setTimeout(load, 300); }

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
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- Tabs / sort ----------

function setCat(cat) {
  currentCat = cat;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
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
  syncDropdown();
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
  load();
}

function renderSortIndicators() {
  document.querySelectorAll('th').forEach(th => {
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.remove();
    if (!refLatLng && th.dataset.col === sortCol) {
      const span = document.createElement('span');
      span.className = 'sort-ind';
      span.textContent = sortDir === 'asc' ? '▲' : '▼';
      th.appendChild(span);
    }
  });
}

// ---------- Load ----------

async function load() {
  if (refLatLng) {
    const params = new URLSearchParams();
    params.set('lat', refLatLng.lat);
    params.set('lng', refLatLng.lng);
    params.set('category', currentCat);
    const t = document.getElementById('typology').value;
    if (t) params.set('typology', t);
    const res = await fetch('/api/nearby?' + params.toString());
    const rows = await res.json();
    render(rows, { proximity: true });
    renderSortIndicators();
    return;
  }

  const params = new URLSearchParams();
  params.set('category', currentCat);
  params.set('sort_col', sortCol);
  params.set('sort_dir', sortDir);
  const q = document.getElementById('q').value;
  const t = document.getElementById('typology').value;
  const mn = document.getElementById('minPrice').value;
  const mx = document.getElementById('maxPrice').value;
  if (q) params.set('q', q);
  if (t) params.set('typology', t);
  if (mn) params.set('min_price', mn);
  if (mx) params.set('max_price', mx);

  const res = await fetch('/api/listings?' + params.toString());
  const rows = await res.json();
  render(rows);
  renderSortIndicators();
}

// ---------- Render ----------

function render(rows, opts) {
  opts = opts || {};
  const prox = !!opts.proximity;
  const shown = rows.length;
  const total = (window.__counts && window.__counts[currentCat]) || shown;
  let text;
  if (prox) {
    text = shown + ' ' + currentCat + ' · sorted by distance';
  } else if (total > shown) {
    text = 'Showing ' + shown + ' of ' + total + ' ' + currentCat;
  } else {
    text = shown + ' ' + currentCat;
  }
  document.getElementById('stats').textContent = text;

  if (!rows.length) {
    document.getElementById('content').innerHTML =
      '<div class="empty">Nothing here</div>';
    return;
  }

  const headers = [
    { col: 'title',     label: 'Title' },
    { col: 'typology',  label: 'Typology' },
    { col: 'price',     label: 'Price' },
    { col: 'location',  label: 'Location' },
    { col: 'phone',     label: 'Phone' },
    { col: 'timestamp', label: 'Date' },
    { col: 'chat_name', label: 'Source' }
  ];
  if (prox) headers.splice(1, 0, { col: 'distance', label: 'Distance' });

  let html = '<table><thead><tr>';
  html += '<th class="row-num" data-col="row-num">#</th>';
  for (let k = 0; k < headers.length; k++) {
    const h = headers[k];
    const clickable = !prox && h.col !== 'distance';
    html += '<th data-col="' + h.col + '"' +
            (clickable ? ' onclick="setSort(\'' + h.col + '\')"' : '') +
            '>' + h.label + '</th>';
  }
  html += '<th data-col="actions">Actions</th></tr></thead><tbody>';

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const date = r.timestamp ? r.timestamp.slice(0, 10) : '';
    const price = r.price
      ? r.price.toLocaleString('pt-AO') + ' Kz'
      : (r.price_text || '—');

    let locCell;
    if (r.location) {
      locCell = '<div>' + esc(r.location) + '</div>';
      if (r.location_raw && r.location_raw.toLowerCase() !== r.location.toLowerCase()) {
        locCell += '<span class="loc-raw">' + esc(r.location_raw) + '</span>';
      }
    } else if (r.location_raw) {
      locCell = '<span class="loc-raw">' + esc(r.location_raw) + '</span>';
    } else {
      locCell = '<span class="loc-raw">—</span>';
    }

    let distCell = '';
    if (prox) {
      distCell = '<td><span class="dist-badge">' + fmtDistance(r.distance_km) + '</span></td>';
    }

    html += '<tr>' +
      '<td class="row-num">' + (i + 1) + '</td>' +
      distCell +
      '<td class="title"><details><summary>' + titleOr(r.title, '(sem título)') + '</summary><pre>' + esc(r.raw_text) + '</pre></details></td>' +
      '<td>' + (r.typology ? '<span class="tag">' + esc(r.typology) + '</span>' : '') + '</td>' +
      '<td class="price">' + esc(price) + '</td>' +
      '<td>' + locCell + '</td>' +
      '<td>' + esc(r.phone) + '</td>' +
      '<td>' + esc(date) + '</td>' +
      '<td>' + esc(r.chat_name) + '</td>' +
      '<td class="actions">' +
        '<a class="copy-btn open-btn" href="/listing/' + encodeURIComponent(r.msg_id) + '" target="_blank">Open</a>' +
        '<button class="copy-btn" onclick="copySearchByIndex(' + i + ')">Find in WhatsApp</button>' +
      '</td>' +
    '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('content').innerHTML = html;
  window.__rows = rows;

  attachResizers();
}

function copySearchByIndex(i) {
  const row = window.__rows[i];
  if (row) copySearch(row);
}

async function copySearch(row) {
  let snippet = (row.title || '').trim();
  if (snippet.length < 10 && row.raw_text) {
    snippet = row.raw_text.trim().slice(0, 60);
  }
  snippet = snippet.split('\n')[0].trim().slice(0, 60);
  try {
    await navigator.clipboard.writeText(snippet);
    showToast('Copied. Paste into WhatsApp search (Ctrl+V).');
  } catch (e) {
    showToast('Copy failed — select the text manually.');
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

// ---------- Counts ----------

async function loadCounts() {
  try {
    const res = await fetch('/api/counts');
    window.__counts = await res.json();
  } catch (e) {
    window.__counts = {};
  }
}

// ---------- Boot ----------

(async function() {
  loadColumnWidths();
  wireGeoSearch();
  loadSyncStatus();
  setInterval(loadSyncStatus, 60000);
  await loadCounts();
  try {
    const res = await fetch('/api/listings?category=rental');
    const rows = await res.json();
    if (rows.length === 0) {
      refresh();
    } else {
      load();
    }
  } catch (e) {
    load();
  }
})();