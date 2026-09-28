// UI state persistence via sessionStorage.
// Everything the user toggles (tab, sort, filters, map, ref point, scroll)
// is saved here so navigating away and back restores the same view.

const UI_KEY = 'uiState';

const UI_DEFAULTS = {
  currentCat: 'rental',
  sortCol: 'timestamp',
  sortDir: 'desc',
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

// Convenience: pull a slice of UI state into the globals app.js uses.
function uiStateApplyToGlobals() {
  const s = uiStateLoad();
  currentCat = s.currentCat;
  sortCol = s.sortCol;
  sortDir = s.sortDir;
  return s;
}

// Populate filter inputs from saved state. Call once at boot.
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

// Set the active tab class based on currentCat.
function uiStateRestoreTabs() {
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.cat === currentCat);
  });
}

// Read the current filter input values back into UI state.
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

// Save scroll position — called on pagehide and before navigation.
function uiStateSaveScroll() {
  uiStateSave({ scrollY: window.scrollY || 0 });
}

function uiStateRestoreScroll() {
  const s = uiStateLoad();
  if (s.scrollY > 0) {
    // Defer so layout is settled first.
    requestAnimationFrame(function () {
      window.scrollTo(0, s.scrollY);
    });
  }
}

window.addEventListener('pagehide', uiStateSaveScroll);
window.addEventListener('beforeunload', uiStateSaveScroll);