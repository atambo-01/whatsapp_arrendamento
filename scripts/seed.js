// Generates ~400 realistic listings through the real parser for offline dev.
// Usage: LISTINGS_DB=listings.dev.db npm run seed
import { rmSync } from "node:fs";
import { config } from "../src/config.js";

for (const s of ["", "-wal", "-shm"]) rmSync(config.dbPath + s, { force: true });

const { upsertMany } = await import("../src/db/listings.js");
const { parseListing } = await import("../src/parser/index.js");
const { knownLocations } = await import("../src/data/locations.js");

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const places = knownLocations.filter((l) => !/\s\d$/.test(l));
const groups = ["Arrendamentos Luanda", "Casas Talatona", "Imobiliária Angola", "Alugo Casa Luanda"];
const typ = ["T1", "T2", "T3", "T4", "V3", "V4", "Moradia", "Apartamento"];
const phone = () => `9${rnd([2, 3, 4, 5])}${Math.floor(1e7 + Math.random() * 9e6)}`;
const kz = (min, max) => Math.round((min + Math.random() * (max - min)) / 5000) * 5000;

const makers = {
  rental: () =>
    `Arrenda-se ${rnd(typ)} no ${rnd(places)}\nRenda: ${kz(60000, 600000)} Kz\nCom quintal e garagem.\nContacto: ${phone()}`,
  seeker: () => `Procuro ${rnd(typ)} para arrendar na zona do ${rnd(places)}, até ${kz(80000, 400000)} kz. ${phone()}`,
  sale: () =>
    `Vende-se ${rnd(typ)} no ${rnd(places)} por ${Math.floor(8 + Math.random() * 90)} milhões de Kz. Ligar ${phone()}`,
  noise: () =>
    rnd([
      "Vendo Toyota Hilux 2018 em bom estado",
      "iPhone 13 pro novo à venda",
      "Bom dia a todos, feliz semana!",
      "Canalizador disponível para serviços",
      "Vendo sofá e mesa de jantar",
    ]),
};

const rows = [];
let n = 0;
for (const [cat, make] of Object.entries(makers)) {
  for (let i = 0; i < 100; i++) {
    const g = rnd(groups);
    rows.push(
      parseListing({
        msgId: `seed-${cat}-${n++}`,
        chatName: g,
        chatJid: `${groups.indexOf(g)}@g.us`,
        timestamp: new Date(Date.now() - Math.random() * 30 * 864e5).toISOString(),
        sender: rnd(["Ana", "Carlos", "Mateus", "Joana", "Pedro"]),
        senderJid: `244${phone()}@c.us`,
        text: make(),
      }),
    );
  }
}
upsertMany(rows);
console.log(`seeded ${rows.length} rows into ${config.dbPath}`);
