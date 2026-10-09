// Compara classificadores sobre test/eval/messages.json.
// Uso: node test/eval/report.mjs [predicoes-modelo.json]
import fs from "node:fs";
import { classify } from "../../src/parser/classify.js";

const data = JSON.parse(fs.readFileSync(new URL(process.env.EVAL_SET || "./messages.json", import.meta.url)));
const LABELS = ["rental", "sale", "seeker", "noise"];

export function metrics(name, preds, verbose = false) {
  const cm = Object.fromEntries(LABELS.map((a) => [a, Object.fromEntries(LABELS.map((b) => [b, 0]))]));
  const errors = [];
  data.forEach((d, i) => { cm[d.label][preds[i]]++; if (d.label !== preds[i]) errors.push([d.label, preds[i], d.text]); });
  const acc = data.filter((d, i) => d.label === preds[i]).length / data.length;
  let f1s = [];
  const per = {};
  for (const l of LABELS) {
    const tp = cm[l][l];
    const fp = LABELS.reduce((s, o) => s + (o === l ? 0 : cm[o][l]), 0);
    const fn = LABELS.reduce((s, o) => s + (o === l ? 0 : cm[l][o]), 0);
    const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
    per[l] = { precision: +p.toFixed(2), recall: +r.toFixed(2) };
    f1s.push(p + r ? (2 * p * r) / (p + r) : 0);
  }
  // What matters for the product: junk shown as ad, and real ads lost.
  const falseAds = data.filter((d, i) => d.label === "noise" && preds[i] !== "noise").length;
  const lostAds = data.filter((d, i) => d.label !== "noise" && preds[i] === "noise").length;
  const wrongType = data.filter((d, i) => d.label !== "noise" && preds[i] !== "noise" && d.label !== preds[i]).length;
  console.log(`\n== ${name} ==  acc ${(acc * 100).toFixed(1)}%  macroF1 ${(f1s.reduce((a, b) => a + b) / 4).toFixed(3)}`);
  console.log(`   lixo mostrado como anúncio: ${falseAds}/${data.filter((d) => d.label === "noise").length}   anúncios perdidos: ${lostAds}/${data.filter((d) => d.label !== "noise").length}   tipo errado: ${wrongType}`);
  console.log("   por classe:", JSON.stringify(per));
  if (verbose) for (const [e, g, t] of errors) console.log(`   ✗ esperado ${e.padEnd(6)} obteve ${g.padEnd(6)} | ${t.replace(/\n/g, " ⏎ ").slice(0, 95)}`);
  return { acc, falseAds, lostAds, wrongType };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const verbose = process.argv.includes("-v");
  metrics("classificador final", data.map((d) => classify(d.text)), verbose);
  const mp = process.argv.find((a) => a.endsWith(".json"));
  if (mp) metrics("modelo (joblib)", JSON.parse(fs.readFileSync(mp)).map((p) => p.label), verbose);
}
