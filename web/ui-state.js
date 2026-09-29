// UI state persistence via sessionStorage.
// Everything the user toggles (tab, sort, filters, map, ref point, scroll)
// is saved here so navigating away and back restores the same view.
//
// Theme is stored separately in localStorage (survives tab close).

const UI_KEY = 'uiState';
const THEME_KEY = 'theme';

const UI_DEFAULTS = {
  currentCat: 'rental',
  sortCol: 'timestamp',
  sortDir: 'desc',
  currentPage: 1,
  perPage: 50,
  q: '',
  typology: '',
  minPrice: '',
  maxPrice: '',
  mapOpen: false,
  refLat: null,
  refLng: null,
  refLabel: null,
  scrollY: 0
};

function uiStateLoad() {
  try {
    const raw = sessionStorage.getItem(UI_KEY);
    if (!raw) return Object.assign({}, UI_DEFAULTS);
    const parsed = JSON.parse(raw);
    return Object.assign({}, UI_DEFAULTS, parsed);
  } catch (e) {
    return Object.assign({}, UI_DEFAULTS);
  }
}

function uiStateSave(patch) {
  try {
    const current = uiStateLoad();
    const next = Object.assign({}, current, patch);
    sessionStorage.setItem(UI_KEY, JSON.stringify(next));
  } catch (e) { /* non-fatal */ }
}

function uiStateApplyToGlobals() {
  const s = uiStateLoad();
  currentCat = s.currentCat;
  sortCol = s.sortCol;
  sortDir = s.sortDir;
  currentPage = s.currentPage;
  perPage = s.perPage;
  return s;
}

function uiStateRestoreInputs() {
  const s = uiStateLoad();
  const set = function (id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };
  set('q', s.q);
  set('typology', s.typology);
  set('minPrice', s.minPrice);
  set('maxPrice', s.maxPrice);
}

function uiStateRestoreTabs() {
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.cat === currentCat);
  });
}

function uiStateCaptureInputs() {
  const g = function (id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };
  uiStateSave({
    q: g('q'),
    typology: g('typology'),
    minPrice: g('minPrice'),
    maxPrice: g('maxPrice')
  });
}

function uiStateSaveScroll() {
  uiStateSave({ scrollY: window.scrollY || 0 });
}

function uiStateRestoreScroll() {
  const s = uiStateLoad();
  if (s.scrollY > 0) {
    requestAnimationFrame(function () {
      window.scrollTo(0, s.scrollY);
    });
  }
}

window.addEventListener('pagehide', uiStateSaveScroll);
window.addEventListener('beforeunload', uiStateSaveScroll);

// ---------- Theme ----------

function themeGet() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch (e) { /* non-fatal */ }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function themeApply(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = mode === 'dark' ? '☀️' : '🌙';
    btn.title = mode === 'dark' ? 'Modo claro' : 'Modo escuro';
  }
}

function themeInit() {
  themeApply(themeGet());
}

function themeToggle() {
  const next = themeGet() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* non-fatal */ }
  themeApply(next);
}