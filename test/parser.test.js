import test from "node:test";
import assert from "node:assert/strict";
import { parseListing } from "../src/parser/index.js";

const parse = (text) => parseListing({ msgId: "1", text, timestamp: "t", senderJid: "x@c.us" });

test("rental with price and location", () => {
  const l = parse("Arrenda-se apartamento T3 no Talatona, 450 mil kz. Contacto 923 456 789");
  assert.equal(l.category, "rental");
  assert.equal(l.price, 450000);
  assert.equal(l.location, "Talatona");
  assert.equal(l.phone, "923456789");
});
test("seeker", () => assert.equal(parse("Procuro casa T2 no Kilamba").category, "seeker"));
test("car ad is noise", () => assert.equal(parse("Vende-se Toyota Hilux 2015").category, "noise"));
test("sale price in millions", () => {
  const l = parse("Vendo moradia V4 Belas 85 milhões");
  assert.equal(l.category, "sale");
  assert.equal(l.price, 85000000);
});
