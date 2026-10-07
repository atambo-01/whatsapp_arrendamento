const nf = new Intl.NumberFormat("pt-PT");
export const kz = (n) => `${nf.format(n)} Kz`;
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (!(s >= 0)) return "";
  if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `há ${Math.round(s / 86400)} d`;
  return new Date(iso).toLocaleDateString("pt-PT");
}

export const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export function toast(msg, isErr = false) {
  const el = Object.assign(document.createElement("div"), { className: "toast" + (isErr ? " err" : ""), textContent: msg });
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), 3500);
}

export const waLink = (phone, text = "") =>
  phone ? `https://wa.me/${phone.startsWith("244") ? phone : "244" + phone}${text ? "?text=" + encodeURIComponent(text) : ""}` : "";
