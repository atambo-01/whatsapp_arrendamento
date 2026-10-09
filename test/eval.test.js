import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classify } from "../src/parser/classify.js";

// Hand-written, labelled messages (pt-AO). A = used while tuning, B = held-out.
// Guard rails: little junk shown as ads, almost no real ads lost, right type.
for (const [file, minAcc] of [["messages.json", 0.97], ["messages_b.json", 0.95]]) {
  test(`classifier on ${file}`, () => {
    const data = JSON.parse(fs.readFileSync(new URL(`./eval/${file}`, import.meta.url)));
    const preds = data.map((d) => classify(d.text));
    const wrong = data.filter((d, i) => d.label !== preds[i]);
    const junk = data.filter((d, i) => d.label === "noise" && preds[i] !== "noise").length;
    const lost = data.filter((d, i) => d.label !== "noise" && preds[i] === "noise").length;
    const acc = 1 - wrong.length / data.length;
    assert.ok(acc >= minAcc, `accuracy ${acc.toFixed(3)} < ${minAcc}: ${wrong.map((d) => d.text.slice(0, 40)).join(" | ")}`);
    assert.ok(junk <= 1, `${junk} junk messages shown as ads`);
    assert.ok(lost <= 1, `${lost} real ads lost`);
  });
}
