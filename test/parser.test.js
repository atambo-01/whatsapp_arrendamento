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

// ---- Generic / off-topic messages must not become listings ----
const noise = [
  "Alguém tem casa?",
  "Preciso de uma casa",
  "Quem sabe de um canalizador?",
  "Vendo bolos e salgados, encomendas 923000111",
  "Bom dia a todos, feliz semana!",
  "Vendo sofá para casa nova 50 mil",
  "O aluguer está caríssimo este mês",
  "Quero uma pizza",
  "Aluga-se casa",
  "Pessoal, a minha casa foi arrombada ontem, cuidado com os ladrões na zona",
];
for (const t of noise) test(`noise: ${t}`, () => assert.equal(parse(t).category, "noise"));

test("greeting before a rental ad", () =>
  assert.equal(parse("Bom dia! Aluga-se casa T2 no Kilamba, renda 250.000 kz, 923111222").category, "rental"));
test("rental without intent word but complete", () =>
  assert.equal(parse("T2 no Zango, 120000kz, ligar 912345678").category, "rental"));
test("seeker with details", () =>
  assert.equal(parse("Bom dia, preciso de um quarto na zona do Talatona até 80 mil").category, "seeker"));
test("sale of land", () =>
  assert.equal(parse("Vende-se terreno 20x30 no Dombe Grande, 5 milhões, 923000111").category, "sale"));
