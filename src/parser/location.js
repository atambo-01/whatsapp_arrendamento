import { knownLocations } from "../data/locations.js";
import { locationMarkers, numberedBases } from "../data/markers.js";
import { reWord } from "./patterns.js";
import { similarity } from "./text.js";

const hasTrailingNumber = (loc) => {
  const parts = loc.split(/\s+/);
  return parts.length >= 2 && /^[0-9]$/.test(parts[parts.length - 1]);
};

export function matchLocation(text) {
  const lower = text.toLowerCase();

  for (const base of numberedBases) {
    for (const d of "012345") {
      for (const pat of [`${base} ${d}`, `${base}${d}`]) {
        if (!lower.includes(pat)) continue;
        const hit = knownLocations.find((loc) => {
          const ll = loc.toLowerCase();
          return ll.startsWith(base + " ") && ll.endsWith(" " + d);
        });
        if (hit) return hit;
      }
    }
  }

  for (const loc of knownLocations) {
    if (lower.includes(loc.toLowerCase()) && !hasTrailingNumber(loc)) return loc;
  }

  const words = text.match(reWord) || [];
  let best = 0;
  let bestLoc = "";
  for (const loc of knownLocations) {
    if (hasTrailingNumber(loc)) continue;
    const ll = loc.toLowerCase();
    for (let size = 1; size <= 3; size++) {
      for (let i = 0; i + size <= words.length; i++) {
        const score = similarity(words.slice(i, i + size).join(" ").toLowerCase(), ll);
        if (score > best) [best, bestLoc] = [score, loc];
      }
    }
  }
  return best >= 0.8 ? bestLoc : "";
}

function truncate(s) {
  s = s.trim().replace(/[ .,;:-]+$/, "");
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export function extractLocationRaw(text) {
  for (const line of text.split("\n")) {
    const lineLower = line.toLowerCase();
    for (const marker of locationMarkers) {
      const idx = lineLower.indexOf(marker);
      if (idx < 0) continue;
      const after = line.slice(idx + marker.length).replace(/^[ :,\-\t]+/, "");
      if (after.length > 2) return truncate(after);
    }
  }

  const words = text.match(reWord) || [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (w.length < 4 || w.length > 15) continue;
    for (const marker of locationMarkers) {
      if (/[ .:]/.test(marker)) continue;
      if (similarity(w, marker) >= 0.78) {
        const candidate = words.slice(i + 1, Math.min(i + 6, words.length)).join(" ");
        if (candidate.length > 2) return truncate(candidate);
      }
    }
  }
  return "";
}
