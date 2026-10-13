// web/time.js
// Relative timestamps for Jinzo listings.
// All comparisons use the viewer's local timezone — "yesterday"
// is a calendar concept, not a 24-hour window.

function formatRelativeTime(isoString) {
  if (!isoString) return "";

  const then = new Date(isoString);
  if (isNaN(then.getTime())) return "";

  const now = new Date();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin === 1 ? "1 min ago" : diffMin + " min ago";
  if (diffHr < 12)  return diffHr + "h ago";

  if (isSameDay(then, now)) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(then, yesterday)) return "yesterday";

  const opts = { day: "numeric", month: "short" };
  if (then.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return then.toLocaleDateString(undefined, opts);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

// Re-render visible timestamps every 30s so "5 min ago" doesn't get stale.
setInterval(() => {
  document.querySelectorAll("[data-ts]").forEach(el => {
    el.textContent = formatRelativeTime(el.dataset.ts);
  });
}, 30000);