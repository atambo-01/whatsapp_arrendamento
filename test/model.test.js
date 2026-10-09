import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalize, predictProba } from "../src/parser/model.js";

// Reference values produced by scikit-learn (models/classificador_msg.py) for the
// exported model; the JS port must match them.
const ref = JSON.parse(fs.readFileSync(new URL("./eval/model_reference.json", import.meta.url)));

for (const r of ref) {
  test(`model parity: ${JSON.stringify(r.text).slice(0, 40)}`, () => {
    assert.equal(normalize(r.text), r.norm);
    const p = predictProba(r.text);
    for (const [k, v] of Object.entries(r.p)) assert.ok(Math.abs(p[k] - v) < 1e-3, `${k}: ${p[k]} vs ${v}`);
  });
}
