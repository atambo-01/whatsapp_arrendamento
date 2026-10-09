import { classify, classifyWhy, isNoise, noiseReason } from "./classify.js";
import { extractLocationRaw, matchLocation } from "./location.js";
import {
  TYPOLOGY_HEAD_WORDS, rePhone, reTypology, reTypologyGeneric, reURL,
} from "./patterns.js";
import { adjustRentalPrice, extractPrice, priceInRange } from "./price.js";
import { firstNWords } from "./text.js";

const SKIP_LINES = new Set(["", "👇🏽", "👇"]);

function extractTitle(clean) {
  for (let line of clean.split("\n")) {
    line = line.trim();
    if (SKIP_LINES.has(line) || line.startsWith(">")) continue;
    return line.length > 120 ? line.slice(0, 120) + "…" : line;
  }
  return "";
}

function extractTypology(clean) {
  let m = clean.match(reTypology);
  if (!m) {
    const g = clean.match(reTypologyGeneric);
    if (g && reTypologyGeneric.test(firstNWords(clean, TYPOLOGY_HEAD_WORDS))) m = g;
  }
  return m ? m[0].replace(/ /g, "").toUpperCase() : "";
}

/** Turn a raw WhatsApp message into a Listing row. */
export function parseListing({
  msgId, chatName, chatJid, timestamp, sender, senderJid, text, displayText = "",
}) {
  const l = {
    msg_id: msgId, chat_name: chatName, chat_jid: chatJid, sender,
    sender_jid: senderJid, timestamp, raw_text: text,
    title: "", typology: "", price: 0, price_text: "", price_ok: -1,
    location: "", location_raw: "", phone: "", category: "noise",
  };

  const clean = text.replace(reURL, " ").trim() || text;
  if (isNoise(clean, displayText)) return l;

  l.title = extractTitle(clean);
  l.typology = extractTypology(clean);
  const { price, priceText } = extractPrice(clean);
  l.price = price;
  l.price_text = priceText;
  l.location = matchLocation(clean);
  l.location_raw = extractLocationRaw(clean);

  const phone = clean.match(rePhone);
  if (phone) l.phone = phone[0].replace(/[ -]/g, "");
  else if (senderJid?.endsWith("@c.us")) l.phone = senderJid.replace("@c.us", "");

  l.category = classify(clean);
  if (l.category === "noise") {
    l.typology = "";
    l.price = 0;
    l.price_text = "";
  } else if (l.category === "rental") {
    l.price = adjustRentalPrice(l.price);
  }
  l.price_ok = priceInRange(l.category, l.price);
  return l;
}

/** Explains (pt) how a raw message was classified. */
export function explain(text) {
  const clean = text.replace(reURL, " ").trim() || text;
  return noiseReason(clean) || classifyWhy(clean).reason;
}
