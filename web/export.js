// Export the current results (or the ticked selection) to a PDF.
// Uses jsPDF (window.jspdf.jsPDF) — loaded from /vendor/jspdf.umd.min.js.
//
// Flow:
//   1. openExportDialog()   — shows the modal, summarises what will be exported
//   2. startExport()        — the real work: fetch data, fetch photos, build PDF
//   3. cancelExport()       — abort if the user closes the modal mid-run
//
// Layout lives in export-layout.js. This file is orchestration only.

let EXPORT_CANCELLED = false;

// ---------- Dialog ----------

function openExportDialog() {
  const dlg = document.getElementById('exportDialog');
  const summary = document.getElementById('exportSummary');
  const progress = document.getElementById('exportProgress');
  const startBtn = document.getElementById('exportStartBtn');

  // Reset state
  EXPORT_CANCELLED = false;
  progress.style.display = 'none';
  document.getElementById('exportBarFill').style.width = '0%';
  document.getElementById('exportPhase').textContent = 'A obter dados…';
  startBtn.disabled = false;
  startBtn.textContent = 'Guardar PDF';

  // Summary — how many and which
  const checked = selectionCount();
  let count, label;
  if (checked > 0) {
    count = checked;
    label = count + (count === 1 ? ' anúncio selecionado' : ' anúncios selecionados');
  } else {
    // No selection — everything matching the current filter
    count = (window.__counts && window.__counts[currentCat]) || 0;
    label = 'todos os ' + count + ' anúncios da pesquisa actual';
  }
  summary.textContent = 'Serão exportados ' + label + '.';

  dlg.classList.add('open');
}

function closeExportDialog() {
  const dlg = document.getElementById('exportDialog');
  if (dlg) dlg.classList.remove('open');
  EXPORT_CANCELLED = false;
}

function cancelExport() {
  EXPORT_CANCELLED = true;
  closeExportDialog();
}

function wireExportDialog() {
  const close = document.getElementById('exportCloseBtn');
  const cancel = document.getElementById('exportCancelBtn');
  const start = document.getElementById('exportStartBtn');

  if (close) close.addEventListener('click', cancelExport);
  if (cancel) cancel.addEventListener('click', cancelExport);
  if (start) start.addEventListener('click', startExport);

  document.addEventListener('keydown', function (e) {
    const dlg = document.getElementById('exportDialog');
    if (!dlg || !dlg.classList.contains('open')) return;
    if (e.key === 'Escape') cancelExport();
  });
}

// ---------- Progress helpers ----------

function setPhase(text) {
  const el = document.getElementById('exportPhase');
  if (el) el.textContent = text;
}

function setProgress(pct) {
  const el = document.getElementById('exportBarFill');
  if (el) el.style.width = Math.min(100, Math.max(0, pct)) + '%';
}

// ---------- Main ----------

async function startExport() {
  const startBtn = document.getElementById('exportStartBtn');
  const progress = document.getElementById('exportProgress');

  startBtn.disabled = true;
  startBtn.textContent = 'A preparar…';
  progress.style.display = 'block';

  try {
    // 1. Which listings?
    const ids = await resolveListingIds();
    if (EXPORT_CANCELLED) return;
    if (ids.length === 0) {
      showToast('Nada para exportar.');
      closeExportDialog();
      return;
    }

    // 2. Fetch full data + media for each listing
    setPhase('A obter dados… 0 de ' + ids.length);
    setProgress(0);
    const listings = await fetchListings(ids, (done, total) => {
      setPhase('A obter dados… ' + done + ' de ' + total);
      setProgress((done / total) * 40);
    });
    if (EXPORT_CANCELLED) return;

    // 3. Fetch photos, resize, embed — capped by the photo-limit radio
    const photoLimit = getPhotoLimit();
    const photoJobs = [];
    for (const l of listings) {
      const refs = (l.media || []).slice(0, photoLimit === Infinity ? undefined : photoLimit);
      for (const ref of refs) {
        photoJobs.push({ listing: l, ref });
      }
    }

    setPhase('A obter fotos… 0 de ' + photoJobs.length);
    setProgress(40);
    await fetchAllPhotos(photoJobs, (done, total) => {
      setPhase('A obter fotos… ' + done + ' de ' + total);
      setProgress(40 + (done / Math.max(1, total)) * 50);
    });
    if (EXPORT_CANCELLED) return;

    // 4. Build the PDF
    setPhase('A gerar PDF…');
    setProgress(90);
    const doc = buildPDF(listings, photoLimit);

    // 5. Save
    const filename = 'jinzo-casas-' + todayStamp() + '.pdf';
    doc.save(filename);

    setProgress(100);
    setPhase('Concluído.');
    startBtn.textContent = 'Guardar PDF';

    setTimeout(closeExportDialog, 800);
  } catch (e) {
    console.error('export failed', e);
    setPhase('Erro: ' + (e.message || e));
    startBtn.disabled = false;
    startBtn.textContent = 'Tentar novamente';
  }
}

// ---------- Data resolution ----------

// Returns an array of msg_ids to export.
async function resolveListingIds() {
  const checked = selectionAll();
  if (checked.length > 0) return checked;

  // No selection — fetch all rows matching the current filter.
  const params = currentFilterParams();
  params.set('per_page', '5000');
  params.set('page', '1');
  const res = await fetch('/api/listings?' + params.toString());
  const data = await res.json();
  return (data.rows || []).map(r => r.msg_id);
}

// Mirror of what app.js load() sends, but without pagination.
function currentFilterParams() {
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
  return params;
}

function getPhotoLimit() {
  const el = document.querySelector('input[name="photoLimit"]:checked');
  if (!el) return 3;
  if (el.value === 'all') return Infinity;
  return parseInt(el.value, 10) || 3;
}

// Fetch full listing objects (with media refs) for the given ids.
// Runs N at a time. Reports progress after each finishes.
async function fetchListings(ids, onProgress) {
  const out = new Array(ids.length);
  const CONCURRENCY = 6;
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      if (EXPORT_CANCELLED) return;
      const i = cursor++;
      const id = ids[i];
      try {
        const cached = (window.__exportListingCache || {})[id];
        if (cached) {
          out[i] = cached;
        } else {
          const res = await fetch('/api/listing/' + encodeURIComponent(id));
          if (res.ok) out[i] = await res.json();
        }
      } catch (e) {
        console.warn('listing fetch failed', id, e);
      }
      done++;
      onProgress(done, ids.length);
    }
  }

  const workers = [];
  for (let k = 0; k < Math.min(CONCURRENCY, ids.length); k++) workers.push(worker());
  await Promise.all(workers);

  return out.filter(Boolean);
}

// ---------- Photo fetching ----------

// Attaches a `dataUrl` field to each ref in photoJobs.
async function fetchAllPhotos(jobs, onProgress) {
  const CONCURRENCY = 4;
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      if (EXPORT_CANCELLED) return;
      const job = jobs[cursor++];
      try {
        job.ref.dataUrl = await fetchPhotoAsDataUrl(job.ref.url);
      } catch (e) {
        job.ref.dataUrl = null;
      }
      done++;
      onProgress(done, jobs.length);
    }
  }

  const workers = [];
  for (let k = 0; k < Math.min(CONCURRENCY, jobs.length); k++) workers.push(worker());
  await Promise.all(workers);
}

// Fetch, decode, resize to ~800px wide, re-encode as JPEG q=0.7.
// Returns a data URL, or null on failure.
async function fetchPhotoAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();

  const bitmap = await createImageBitmap(blob);
  const MAX = 800;
  let w = bitmap.width, h = bitmap.height;
  if (w > MAX || h > MAX) {
    const scale = Math.min(MAX / w, MAX / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', 0.7);
}

// ---------- Utils ----------

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}