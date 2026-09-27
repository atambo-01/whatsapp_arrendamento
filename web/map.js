// ---------- Map ----------
// Map state lives here. `refLatLng` is the picked reference point; when set,
// app.js's load() routes through /api/nearby instead of /api/listings.

let map = null;
let marker = null;
let refLatLng = null;

let geoDebounce = null;
let geoResults = [];
let geoActiveIndex = -1;

function toggleMap() {
  const wrap = document.getElementById('mapWrap');
  const btn = document.getElementById('mapToggle');
  const showing = wrap.style.display !== 'none';

  if (showing) {
    wrap.style.display = 'none';
    btn.classList.remove('active');
    clearRef();
    return;
  }

  wrap.style.display = 'block';
  btn.classList.add('active');
  if (!map) initMap();
  setTimeout(function() { map.invalidateSize(); }, 50);
}

function initMap() {
  map = L.map('map').setView([-8.90, 13.25], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  map.on('click', function(e) {
    setRefPoint(e.latlng.lat, e.latlng.lng, null);
  });
}

function setRefPoint(lat, lng, label) {
  if (!map) return;
  refLatLng = L.latLng(lat, lng);
  if (marker) {
    marker.setLatLng(refLatLng);
  } else {
    marker = L.marker(refLatLng).addTo(map);
  }
  const el = document.getElementById('refPoint');
  el.textContent = label
    ? label + ' (' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')'
    : lat.toFixed(4) + ', ' + lng.toFixed(4);
  load();
}

function clearRef() {
  refLatLng = null;
  if (map && marker) {
    map.removeLayer(marker);
    marker = null;
  }
  const el = document.getElementById('refPoint');
  if (el) el.textContent = 'none';
  const inp = document.getElementById('geoSearch');
  if (inp) inp.value = '';
  hideGeoResults();
  load();
}

// ---------- Geosearch (Nominatim) ----------

function hideGeoResults() {
  const box = document.getElementById('geoResults');
  if (box) { box.classList.remove('show'); box.innerHTML = ''; }
  geoResults = [];
  geoActiveIndex = -1;
}

function renderGeoResults() {
  const box = document.getElementById('geoResults');
  if (!geoResults.length) { hideGeoResults(); return; }
  let html = '';
  for (let i = 0; i < geoResults.length; i++) {
    const r = geoResults[i];
    const cls = 'result-item' + (i === geoActiveIndex ? ' active' : '');
    html += '<div class="' + cls + '" onclick="pickGeoResult(' + i + ')">' +
      '<div class="primary">' + esc(r.primary) + '</div>' +
      (r.secondary ? '<div class="secondary">' + esc(r.secondary) + '</div>' : '') +
      '</div>';
  }
  box.innerHTML = html;
  box.classList.add('show');
}

function pickGeoResult(i) {
  const r = geoResults[i];
  if (!r) return;
  if (map) {
    map.setView([r.lat, r.lng], 15);
  }
  setRefPoint(r.lat, r.lng, r.primary);
  document.getElementById('geoSearch').value = r.primary;
  hideGeoResults();
}

function splitNominatimName(displayName) {
  const parts = (displayName || '').split(',').map(s => s.trim());
  if (parts.length <= 1) return { primary: displayName || '', secondary: '' };
  return {
    primary: parts[0],
    secondary: parts.slice(1).join(', ')
  };
}

async function geosearch(query) {
  const status = document.getElementById('geoStatus');
  if (!query || query.length < 3) { hideGeoResults(); status.textContent = ''; return; }
  status.textContent = 'Searching…';
  try {
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=json'
      + '&limit=6'
      + '&addressdetails=0'
      + '&viewbox=13.10,-8.75,13.55,-9.25'
      + '&bounded=1'
      + '&q=' + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    geoResults = data.map(d => {
      const parts = splitNominatimName(d.display_name);
      return {
        primary: parts.primary,
        secondary: parts.secondary,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon)
      };
    });
    status.textContent = geoResults.length
      ? geoResults.length + ' result' + (geoResults.length === 1 ? '' : 's')
      : 'No results';
    renderGeoResults();
  } catch (e) {
    status.textContent = 'Search failed';
    hideGeoResults();
  }
}

function wireGeoSearch() {
  const inp = document.getElementById('geoSearch');
  if (!inp) return;

  inp.addEventListener('input', function() {
    clearTimeout(geoDebounce);
    const q = inp.value.trim();
    geoDebounce = setTimeout(function() { geosearch(q); }, 400);
  });

  inp.addEventListener('keydown', function(e) {
    if (!geoResults.length) {
      if (e.key === 'Enter') {
        clearTimeout(geoDebounce);
        geosearch(inp.value.trim());
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      geoActiveIndex = Math.min(geoActiveIndex + 1, geoResults.length - 1);
      renderGeoResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      geoActiveIndex = Math.max(geoActiveIndex - 1, 0);
      renderGeoResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (geoActiveIndex >= 0 && geoActiveIndex < geoResults.length) {
        pickGeoResult(geoActiveIndex);
      } else if (geoResults.length > 0) {
        pickGeoResult(0);
      }
    } else if (e.key === 'Escape') {
      hideGeoResults();
    }
  });

  document.addEventListener('click', function(e) {
    const wrap = document.querySelector('.geosearch');
    if (wrap && !wrap.contains(e.target)) hideGeoResults();
  });
}