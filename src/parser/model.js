// Pure-JS inference for the TF-IDF + logistic-regression message classifier
// (models/classificador_msg.py, exported to model.json by models/export_js.py).
// It must reproduce scikit-learn exactly: see test/model.test.js.
import fs from "node:fs";

const MODEL_URL = new URL("./model.json", import.meta.url);
export const THRESHOLD = 0.45; // below this confidence -> "outro" (same as the Python script)
const LABELS = { venda: "sale", arrendamento: "rental", procura: "seeker", outro: "noise" };

let model;
function load() {
  if (model === undefined) {
    try { model = JSON.parse(fs.readFileSync(MODEL_URL, "utf8")); } catch { model = null; }
  }
  return model;
}
export const modelAvailable = () => load() !== null;

const GIRIAS = [
  [/\bk(?=[aouáóú])/g, "c"], [/\bq\b/g, "que"], [/\bpq\b/g, "porque"], [/\bvc\b/g, "voce"], [/\bblz\b/g, "beleza"],
  [/\bap\b/g, "apartamento"], [/\bapt\b/g, "apartamento"], [/\bvd\b/g, "vendo"], [/\bqt\b/g, "quarto"],
  [/\bwhats(app)?\b/g, "zap"], [/\bwpp\b/g, "zap"], [/\bkwanzas?\b/g, "kz"], [/\bkuanzas?\b/g, "kz"],
  [/\bakz\b/g, "kz"], [/\bmilhoes\b/g, "milhao"],
];

/** Port of normalizar() from classificador_msg.py. */
export function normalize(text) {
  let t = text.toLowerCase();
  t = t.normalize("NFKD").replace(/\p{M}/gu, "");
  t = t.replace(/(.)\1{2,}/gsu, "$1");
  t = t.replace(/(?<=[a-z])0(?=[a-z])/g, "o");
  t = t.replace(/(?<=[a-z])3(?=[a-z])/g, "e");
  t = t.replace(/\d+([.,]\d+)*/g, " # ");
  t = t.replace(/[^a-z# ]/g, " ");
  for (const [re, sub] of GIRIAS) t = t.replace(re, sub);
  return t.replace(/\s+/g, " ").trim();
}

function ngramsCharWb(text, [lo, hi]) {
  const out = [];
  for (const word of text.replace(/\s\s+/g, " ").split(/\s+/).filter(Boolean)) {
    const w = ` ${word} `;
    for (let n = lo; n <= hi; n++) {
      let offset = 0;
      out.push(w.slice(offset, offset + n));
      while (offset + n < w.length) { offset++; out.push(w.slice(offset, offset + n)); }
      if (offset === 0) break; // a word shorter than n counts once
    }
  }
  return out;
}

function ngramsWord(text, [lo, hi]) {
  const toks = text.match(/\b\w\w+\b/g) || [];
  const out = [];
  for (let n = lo; n <= hi; n++) for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(" "));
  return out;
}

/** Sparse tf-idf of one vectorizer (sublinear tf, idf, L2-normalised) as [index, value] pairs. */
function vectorize(vec, text) {
  const grams = vec.analyzer === "char_wb" ? ngramsCharWb(text, vec.ngram) : ngramsWord(text, vec.ngram);
  const counts = new Map();
  for (const g of grams) {
    const i = vec.vocab[g];
    if (i !== undefined) counts.set(i, (counts.get(i) || 0) + 1);
  }
  const feats = [...counts].map(([i, c]) => [vec.offset + i, (1 + Math.log(c)) * vec.idf[i]]);
  const norm = Math.sqrt(feats.reduce((s, [, v]) => s + v * v, 0)) || 1;
  return feats.map(([i, v]) => [i, v / norm]);
}

/** Class probabilities {rental, sale, seeker, noise} for a raw message. */
export function predictProba(text) {
  const m = load();
  if (!m) return null;
  const norm = normalize(text);
  const feats = m.vectorizers.flatMap((v) => vectorize(v, norm));
  const z = m.classes.map((_, c) => m.intercept[c] + feats.reduce((s, [i, v]) => s + m.coef[c][i] * v, 0));
  const max = Math.max(...z);
  const e = z.map((x) => Math.exp(x - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return Object.fromEntries(m.classes.map((c, i) => [LABELS[c], e[i] / sum]));
}

/** {label, conf}: the most probable class, or noise when not confident enough. */
export function predict(text) {
  const p = predictProba(text);
  if (!p) return null;
  const [label, conf] = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  return { label: conf < THRESHOLD ? "noise" : label, conf, proba: p };
}
