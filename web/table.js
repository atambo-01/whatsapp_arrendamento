// Table rendering for the main listings page.
// Accepts a paginated response: {rows, total, page, per_page, total_pages}.
// Two-panel inline expansion on row-number click: raw text left, thumbnails right.

const MEDIA_CACHE = {};
const THUMB_LIMIT = 6;

// ---------- Selection ----------
// Persisted in sessionStorage under 'jinzoSelection'.
// A Set of msg_ids that the user has ticked for export.
// Cleared by app.js on filter/tab/sort change; survives pagination and nav.

const SELECTION_KEY = 'jinzoSelection';

function onRowSelectChange(msgId, checkbox) {
  selectionToggle(msgId, checkbox.checked);
  const tr = checkbox.closest('tr');
  if (tr) tr.classList.toggle('selected', checkbox.checked);
  updateSelectAllHeader();
}

function selectionGet() {
  try {
    const raw = sessionStorage.getItem(SELECTION_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

function selectionSave(set) {
  try {
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify([...set]));
  } catch (e) { /* non-fatal */ }
}

function selectionToggle(msgId, checked) {
  const s = selectionGet();
  if (checked) s.add(msgId); else s.delete(msgId);
  selectionSave(s);
}

function selectionHas(msgId) {
  return selectionGet().has(msgId);
}

function selectionClear() {
  try { sessionStorage.removeItem(SELECTION_KEY); } catch (e) { /* non-fatal */ }
}

function selectionCount() {
  return selectionGet().size;
}

function selectionAll() {
  return [...selectionGet()];
}

// Toggle all rows currently on this page.
function toggleSelectAll(checked) {
  const s = selectionGet();
  for (const r of (window.__rows || [])) {
    if (checked) s.add(r.msg_id); else s.delete(r.msg_id);
  }
  selectionSave(s);
  // Re-render just the checkboxes without reloading the table.
  document.querySelectorAll('tr[data-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.idx, 10);
    const row = (window.__rows || [])[idx];
    if (!row) return;
    const cb = tr.querySelector('td.col-select input');
    if (cb) cb.checked = selectionHas(row.msg_id);
    tr.classList.toggle('selected', cb && cb.checked);
  });
  updateSelectAllHeader();
}

function updateSelectAllHeader() {
  const master = document.getElementById('selectAllHeader');
  if (!master) return;
  const rows = window.__rows || [];
  if (rows.length === 0) {
    master.checked = false;
    master.indeterminate = false;
    return;
  }
  let checked = 0;
  for (const r of rows) if (selectionHas(r.msg_id)) checked++;
  master.checked = checked === rows.length && rows.length > 0;
  master.indeterminate = checked > 0 && checked < rows.length;
}

function renderTable(data, opts) {
  opts = opts || {};
  const prox = !!opts.proximity;

  const rows = data.rows || [];
  const total = data.total || 0;
  const page = data.page || 1;
  const totalPages = data.total_pages || 1;

  let statText;
  if (total === 0) {
    statText = 'No ' + currentCat;
  } else {
    const start = (page - 1) * (data.per_page || 50) + 1;
    const end = start + rows.length - 1;
    statText = 'Showing ' + start + '–' + end + ' of ' + total + ' ' + currentCat;
    if (prox) statText += ' · sorted by distance';
    if (totalPages > 1) statText += ' · page ' + page + ' of ' + totalPages;
  }
  document.getElementById('stats').textContent = statText;

  if (rows.length === 0) {
    document.getElementById('content').innerHTML = '<div class="empty">Nothing here</div>';
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
  if (prox) headers.splice(0, 0, { col: 'distance', label: 'Distance' });

  let html = '<table><thead><tr>';
  html += '<th class="row-num" data-col="row-num">#</th>';
  html += '<th class="col-select" data-col="select"><input type="checkbox" id="selectAllHeader" onclick="event.stopPropagation(); toggleSelectAll(this.checked)"></th>';

  for (let k = 0; k < headers.length; k++) {
    const h = headers[k];
    const clickable = !prox && h.col !== 'distance';
    html += '<th data-col="' + h.col + '"' +
            (clickable ? ' onclick="setSort(\'' + h.col + '\')"' : '') +
            '>' + h.label + '</th>';
  }
  html += '<th data-col="actions">Actions</th></tr></thead><tbody>';

  const colspan = headers.length + 3;

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

    const detailUrl = '/listing/' + encodeURIComponent(r.msg_id);
    const panelId = 'panel-' + i;
    const globalIdx = (page - 1) * (data.per_page || 50) + i + 1;

    const isSelected = selectionHas(r.msg_id);
    html += '<tr data-idx="' + i + '"' + (isSelected ? ' class="selected"' : '') + '>' +
      '<td class="row-num" onclick="toggleRow(\'' + panelId + '\',\'' + r.msg_id + '\')" title="Expandir/colapsar">' + globalIdx + '</td>' +
      '<td class="col-select" onclick="event.stopPropagation()"><input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onchange="onRowSelectChange(\'' + esc(r.msg_id) + '\', this)"></td>' +
      distCell +
      '<td class="title"><a class="title-link" href="' + detailUrl + '">' + titleOr(r.title, '(sem título)') + '</a></td>' +
      '<td>' + (r.typology ? '<span class="tag">' + esc(r.typology) + '</span>' : '') + '</td>' +
      '<td class="price">' + esc(price) + '</td>' +
      '<td>' + locCell + '</td>' +
      '<td>' + esc(r.phone) + '</td>' +
      '<td>' + esc(date) + '</td>' +
      '<td>' + esc(r.chat_name) + '</td>' +
      '<td class="actions">' +
        '<a class="copy-btn open-btn" href="' + detailUrl + '">Open</a>' +
        '<button class="copy-btn send-btn" onclick="openSendDialog(\'' +
          esc(r.sender_jid) + '\',\'' + esc(r.sender || r.sender_jid) + '\',\'' +
          esc(r.msg_id) + '\',\'' + esc(r.chat_jid) + '\')">Enviar</button>' +
      '</td>' +
    '</tr>';

    html += '<tr class="panel-row" id="' + panelId + '"><td colspan="' + colspan + '">' +
      '<div class="panel-loading">A carregar…</div>' +
    '</td></tr>';
  }

  html += '</tbody></table>';

  if (totalPages > 1) {
    html += '<div class="pagination">';
    html += '<button class="page-btn" onclick="gotoPage(' + (page - 1) + ')"' +
            (page === 1 ? ' disabled' : '') + '>« Anterior</button>';
    html += '<span class="page-picker">';
    html += '<input type="text" inputmode="numeric" pattern="[0-9]*" class="page-input" id="pageInput" value="' + page + '" onkeydown="pageInputKey(event)" onblur="pageInputBlur()" onfocus="this.select()">';
    html += '<span class="page-total">/ ' + totalPages + '</span>';
    html += '</span>';
    html += '<button class="page-btn" onclick="gotoPage(' + (page + 1) + ')"' +
            (page === totalPages ? ' disabled' : '') + '>Próxima »</button>';
    html += '</div>';
  }

  document.getElementById('content').innerHTML = html;
  window.__rows = rows;

  try {
    sessionStorage.setItem('navList', JSON.stringify(rows.map(function (r) { return r.msg_id; })));
  } catch (e) { /* non-fatal */ }

  attachResizers();
  updateSelectAllHeader();
}

function pageInputKey(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
  }
}

function pageInputBlur() {
  const inp = document.getElementById('pageInput');
  if (!inp) return;
  const v = parseInt(inp.value, 10);
  const max = parseInt(inp.getAttribute('max') || '999999', 10);
  const totalPages = window.__totalPages || max;
  if (!isNaN(v) && v >= 1 && v <= totalPages && v !== currentPage) {
    gotoPage(v);
  } else {
    inp.value = currentPage;
  }
}

function toggleRow(panelId, msgId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    return;
  }

  document.querySelectorAll('.panel-row.open').forEach(function (p) {
    p.classList.remove('open');
  });

  panel.classList.add('open');

  const row = window.__rows.find(function (r) { return r.msg_id === msgId; });
  if (!row) return;

  if (MEDIA_CACHE[msgId]) {
    renderPanel(panel, row, MEDIA_CACHE[msgId]);
    return;
  }

  fetch('/api/listing/' + encodeURIComponent(msgId))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      const media = (data && data.media) || [];
      MEDIA_CACHE[msgId] = media;
      renderPanel(panel, row, media);
    })
    .catch(function () {
      renderPanel(panel, row, []);
    });
}

function renderPanel(panel, row, media) {
  const detailUrl = '/listing/' + encodeURIComponent(row.msg_id);

  const textHtml = '<div class="panel-text"><pre>' + esc(row.raw_text || '—') + '</pre></div>';

  let thumbsHtml = '';
  if (media.length === 0) {
    thumbsHtml = '<div class="panel-no-media">Sem média</div>';
  } else {
    const shown = media.slice(0, THUMB_LIMIT);
    thumbsHtml = '<div class="panel-thumbs">';
    for (let i = 0; i < shown.length; i++) {
      const m = shown[i];
      const badge = m.type === 'video' ? '<span class="thumb-video">▶</span>' : '';
      thumbsHtml += '<div class="thumb" onclick="event.stopPropagation(); openLightbox(\'' +
        esc(row.msg_id) + '\',' + i + ')">' +
        '<img src="' + esc(m.url) + '" loading="lazy" alt="" onerror="this.parentElement.style.display=\'none\'">' +
        badge +
        '</div>';
    }
    if (media.length > THUMB_LIMIT) {
      thumbsHtml += '<div class="thumb thumb-more" onclick="event.stopPropagation(); openLightbox(\'' +
        esc(row.msg_id) + '\',' + THUMB_LIMIT + ')">+' + (media.length - THUMB_LIMIT) + '</div>';
    }
    thumbsHtml += '</div>';
  }

  const rightHtml = '<div class="panel-media">' + thumbsHtml + '</div>';

  panel.querySelector('td').innerHTML =
    '<div class="panel" onclick="window.location.href=\'' + detailUrl + '\'">' +
      textHtml +
      rightHtml +
    '</div>';
}