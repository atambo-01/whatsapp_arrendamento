import {
  RENTAL_MAX, RENTAL_MIN, SALE_MAX, SALE_MIN, rePriceK, rePriceNum,
} from "./patterns.js";

const parseNumber = (s) => parseInt(s.replace(/[\s.,]/g, ""), 10) || 0;

function applyMultiplier(n, unit) {
  const u = (unit || "").trim().toLowerCase();
  if (["mil", "k", "kz", "kzs"].includes(u)) return n >= 10000 ? n : n * 1000;
  if (["milhão", "milhões", "milhao", "milhoes", "m"].includes(u)) return n * 1000000;
  return n;
}

export function extractPrice(text) {
  const m = text.match(rePriceK) || text.match(rePriceNum);
  if (!m) return { price: 0, priceText: "" };
  return { price: applyMultiplier(parseNumber(m[1]), m[2]), priceText: m[0].trim() };
}

export function priceInRange(category, price) {
  if (category === "noise" || category === "seeker") return -1;
  if (!price) return 0;
  if (category === "rental") return price >= RENTAL_MIN && price <= RENTAL_MAX ? 1 : 0;
  if (category === "sale") return price >= SALE_MIN && price <= SALE_MAX ? 1 : 0;
  return -1;
}

// Fix prices written as "150" (thousands) or "150000000" (extra zeros).
export function adjustRentalPrice(price) {
  if (price <= 0) return price;
  if (price >= RENTAL_MIN && price <= RENTAL_MAX) return price;
  const mul = price * 1000;
  if (mul >= RENTAL_MIN && mul <= RENTAL_MAX) return mul;
  if (price >= 1000 && price % 1000 === 0) {
    const div = price / 1000;
    if (div >= RENTAL_MIN && div <= RENTAL_MAX) return div;
  }
  return price;
}
