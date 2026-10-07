// Leaflet reference-point picker + Nominatim geosearch.
import { debounce, esc } from "./format.js";

const LUANDA = [-8.8383, 13.2344];
let map, marker, circle, onChange;

export function initMap(el, cb) {
  onChange = cb;
  map = L.map(el).setView(LUANDA, 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap",
  }).addTo(map);
  map.on("click", (e) => setRef(e.latlng.lat, e.latlng.lng, "Ponto no mapa"));
}

export const invalidate = () => setTimeout(() => map?.invalidateSize(), 50);

export function setRef(lat, lng, label, silent = false) {
  if (!marker) marker = L.marker([lat, lng], { draggable: true }).addTo(map)
    .on("dragend", () => { const p = marker.getLatLng(); setRef(p.lat, p.lng, "Ponto no mapa"); });
  marker.setLatLng([lat, lng]);
  map.panTo([lat, lng]);
  if (!silent) onChange?.({ lat, lng, label });
}

export function drawRadius(lat, lng, km) {
  circle?.remove();
  circle = null;
  if (km > 0) circle = L.circle([lat, lng], { radius: km * 1000, color: "#0f9d6b", weight: 1, fillOpacity: 0.08 }).addTo(map);
}

export function clearRef() {
  marker?.remove(); circle?.remove(); marker = circle = null;
}

export function bindGeosearch(input, box) {
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) return (box.hidden = true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ao&q=${encodeURIComponent(q + ", Luanda")}`;
      const res = await (await fetch(url)).json();
      box.innerHTML = res.length
        ? res.map((r, i) => `<button type="button" data-i="${i}">${esc(r.display_name)}</button>`).join("")
        : `<button type="button" disabled>Sem resultados</button>`;
      box.hidden = false;
      box.onclick = (e) => {
        const b = e.target.closest("button[data-i]");
        if (!b) return;
        const r = res[b.dataset.i];
        setRef(+r.lat, +r.lon, r.display_name.split(",")[0]);
        map.setZoom(14);
        input.value = r.display_name.split(",")[0];
        box.hidden = true;
      };
    } catch { box.hidden = true; }
  }, 400);
  input.addEventListener("input", search);
  document.addEventListener("click", (e) => { if (!box.contains(e.target) && e.target !== input) box.hidden = true; });
}
