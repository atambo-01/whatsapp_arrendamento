// Table rendering for the main listings page.
// Two-panel inline expansion on row-number click: raw text left, thumbnails right.
// Thumbnails open the lightbox (see lightbox.js). Clicking elsewhere in the
// panel navigates to the detail page.

const MEDIA_CACHE = {};      // msg_id -> [{url, type, mime, msg_id}]
const THUMB_LIMIT = 6;

// ---------- Public entry ----------

function renderTable(rows, opts) {
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

  const colspan = headers.length + 2;

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
    const rowId = 'row-' + i;
    const panelId = 'panel-' + i;

    html += '<tr data-idx="' + i + '" id="' + rowId + '">' +
      '<td class="row-num" onclick="toggleRow(\'' + panelId + '\',\'' + r.msg_id + '\')" title="Expandir/colapsar">' + (i + 1) + '</td>' +
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
        '<button class="copy-btn" onclick="copySearchByIndex(' + i + ')">Find in WhatsApp</button>' +
      '</td>' +
    '</tr>';

    // Hidden expansion panel — populated lazily on click.
    html += '<tr class="panel-row" id="' + panelId + '"><td colspan="' + colspan + '">' +
      '<div class="panel-loading">A carregar…</div>' +
    '</td></tr>';
  }

  html += '</tbody></table>';
  document.getElementById('content').innerHTML = html;
  window.__rows = rows;

  try {
    sessionStorage.setItem('navList', JSON.stringify(rows.map(function (r) { return r.msg_id; })));
  } catch (e) { /* non-fatal */ }

  attachResizers();
}

// ---------- Expansion ----------

function toggleRow(panelId, msgId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    return;
  }

  // Close any other open panels first.
  document.querySelectorAll('.panel-row.open').forEach(function (p) {
    p.classList.remove('open');
  });

  panel.classList.add('open');

  // Lazy-fetch the listing detail (which includes media) if not cached.
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

  // Left: raw text.
  const textHtml = '<div class="panel-text"><pre>' + esc(row.raw_text || '—') + '</pre></div>';

  // Right: thumbnails.
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
        '<img src="' + esc(m.url) + '" loading="lazy" alt="">' +
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

// ---------- Copy for WhatsApp search ----------

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