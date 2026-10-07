import { distance } from "./levenshtein.js";

export const firstNWords = (s, n) => {
  const words = s.trim().split(/\s+/);
  return words.length <= n ? s : words.slice(0, n).join(" ");
};

const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);

export function containsWord(haystack, needle) {
  needle = needle.toLowerCase();
  let idx = 0;
  for (;;) {
    const i = haystack.indexOf(needle, idx);
    if (i < 0) return false;
    const end = i + needle.length;
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[end])) return true;
    idx = i + 1;
  }
}

export function containsAnyKeyword(text, cls) {
  const lower = text.toLowerCase();
  for (const w of cls.words) if (containsWord(lower, w)) return w;
  return null;
}

export function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}
