import { classByName, keywordClasses } from "./keywords.js";
import { matchLocation } from "./location.js";
import {
  HEAD_WORDS, rePhone, rePriceK, rePriceNum, reMedia, reRentalStrong, reRentalWeak,
  reSaleStrong, reSeekerVerb, reSpam, reTypology, reURL,
} from "./patterns.js";
import { firstNWords } from "./text.js";
import { modelAvailable, predict } from "./model.js";

// A message is a listing only when it has (1) an intent (rent / sale / seek),
// (2) a property reference and (3) enough concrete detail. Anything generic
// ("alguém tem casa?", "vendo bolos", "bom dia") is noise.

const strip = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const tokens = (s) => strip(s).match(/[\p{L}\p{N}]+/gu) || [];

const homeWords = new Set(classByName("home").words.map(strip));
const overrideClasses = keywordClasses.filter((c) => c.isOverride && c.verdict);
const overrideWords = overrideClasses.map((c) => ({ cls: c, set: new Set(c.words.map(strip)) }));

const reGreeting = /^(bom dia|boa tarde|boa noite|boas|ola|oi|ol[aá]|saudações|saudacoes)[\s,!.:;-]*/i;
const reLead = /^[\s*_~>#.\-–—•!👇🏽🏠🏡🔥✅📣📢]+/u;
const reListingVocab =
  /\b(renda|cau[çc][aã]o|contrato|dispon[ií]vel|mobilad[oa]|visita|r\/c|r[eé]s[\s-]?do[\s-]?ch[aã]o|casa de banho|quartos?|sala|cozinha|quintal|garagem|su[ií]te|varanda|[aá]gua|energia|cercad[oa]|condom[ií]nio|m2|m²|andar|pavimento)\b/gi;
const reMillions = /milh(?:ão|ões|ao|oes)/i;

function cleanHead(lower) {
  let t = lower.replace(reLead, "");
  for (let i = 0; i < 2; i++) t = t.replace(reGreeting, "").replace(reLead, "");
  return t;
}

/** Index (in tokens) of the first token that belongs to `set`, or -1. */
const firstIn = (toks, set) => toks.findIndex((t) => set.has(t));

/** Category + reason + evidence score for the admin console. */
export function rulesDetailed(text) {
  const lower = cleanHead(text.toLowerCase());
  const head = firstNWords(lower, HEAD_WORDS);
  const headToks = tokens(head);
  const allToks = tokens(lower);
  const noise = (reason, score = 0) => ({ category: "noise", reason, score });

  if (allToks.length < 3 && !reTypology.test(lower)) return noise("Mensagem demasiado curta");

  // Non-property item (car, phone, furniture, service…) mentioned before any home word.
  const homeAt = firstIn(headToks, homeWords);
  for (const { cls, set } of overrideWords) {
    const at = firstIn(headToks, set);
    if (at < 0) continue;
    if (cls.weakHome && homeAt >= 0 && homeAt < at) continue;
    return noise(`Fala de outro tipo de artigo (${cls.name}), não de imóvel`);
  }

  // Signals
  const typology = reTypology.test(lower);
  const homeCount = new Set(allToks.filter((t) => homeWords.has(t))).size;
  if (!typology && !homeCount) return noise("Sem referência a imóvel (casa, T2, apartamento, terreno…)");

  const priceMatch = lower.match(rePriceK) || lower.match(rePriceNum);
  const price = !!priceMatch;
  const phone = rePhone.test(text);
  const location = !!matchLocation(text);
  const vocab = new Set((lower.match(reListingVocab) || []).map((w) => w.toLowerCase())).size;
  const evidence =
    (typology ? 3 : 0) + (homeCount >= 1 ? 1 : 0) + (homeCount >= 3 ? 1 : 0) +
    (price ? 2 : 0) + (phone ? 1 : 0) + (location ? 1 : 0) + (vocab >= 2 ? 2 : vocab ? 1 : 0);
  const specifics = typology || location || price;

  // Intent
  const seek = reSeekerVerb.test(firstNWords(lower, HEAD_WORDS + 5));
  const saleAt = lower.search(reSaleStrong);
  const rentAt = Math.min(
    ...[lower.search(reRentalStrong), typology ? lower.search(reRentalWeak) : -1].filter((i) => i >= 0), Infinity);

  if (seek) {
    if (!specifics) return noise("Pedido genérico: sem tipologia, zona ou valor", evidence);
    return { category: "seeker", reason: "Pede um imóvel e indica tipologia, zona ou valor", score: evidence };
  }

  const sale = saleAt >= 0;
  const rent = Number.isFinite(rentAt);
  if (sale || rent) {
    if (evidence < 3) return noise("Anúncio com poucos detalhes (sem tipologia, preço ou zona)", evidence);
    const asSale = sale && (!rent || saleAt < rentAt);
    return asSale
      ? { category: "sale", reason: "Termos de venda + imóvel com detalhes (tipologia, preço, zona…)", score: evidence }
      : { category: "rental", reason: "Termos de arrendamento + imóvel com detalhes (tipologia, preço, zona…)", score: evidence };
  }

  // No intent word: only accept a very complete message (type + price + contact/zone).
  if (typology && price && (phone || location || vocab >= 2)) {
    const sold = reMillions.test(priceMatch[0]);
    return {
      category: sold ? "sale" : "rental",
      reason: "Sem palavra de intenção, mas tem tipologia, preço e contacto/zona",
      score: evidence,
    };
  }
  return noise("Menciona imóvel mas sem intenção clara de arrendar, vender ou procurar", evidence);
}

// Words that show a message is about a property (used as a final sanity gate).
const propertyWords = new Set([...homeWords, ...["espaco", "galpao", "imovel", "imoveis", "habitacao", "residencia", "consultorio", "salas"]]);
const mentionsProperty = (text) => reTypology.test(text) || tokens(text).some((w) => propertyWords.has(w));
const wordCount = (text) => (text.replace(reURL, " ").match(/[\p{L}\p{N}]+/gu) || []).length;
const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Final classifier = trained model (intent: rental/sale/seeker/noise, tolerant to
 * typos and slang) + rule vetoes (non-property articles, no property mention, too
 * short). Without model.json it falls back to the rules alone.
 */
export function classifyDetailed(text) {
  const rules = rulesDetailed(text);
  const m = modelAvailable() ? predict(text) : null;
  if (!m) return rules;
  const conf = pct(m.conf);
  const noise = (reason) => ({ category: "noise", reason, score: m.conf });

  if (m.label === "noise") {
    const why = rules.category === "noise" ? ` (${rules.reason})` : "";
    return noise(`Modelo: não é anúncio de imóvel, confiança ${conf}${why}`);
  }
  if (/outro tipo de artigo/.test(rules.reason)) return noise(rules.reason);
  if (wordCount(text) < 3) return noise("Mensagem demasiado curta");
  if (!mentionsProperty(text)) return noise("Sem referência a imóvel (casa, T2, apartamento, terreno…)");
  const agree = rules.category === m.label ? " · confirmado pelas regras" : "";
  return { category: m.label, reason: `Modelo: ${m.label}, confiança ${conf}${agree}`, score: m.conf };
}

export const classifyWhy = classifyDetailed;
export const classify = (text) => classifyDetailed(text).category;

/** Why a message was dropped as noise before classification (or "" if it wasn't). */
export function noiseReason(text, displayText = "") {
  if (displayText.trim().startsWith(">")) return "Resposta citada";
  if (reMedia.test(text.trim())) return "Mensagem de mídia sem texto";
  if (reSpam.test(text)) return "Parece spam/publicidade (apostas, links…)";
  return "";
}

export function isNoise(text, displayText = "") {
  return !!noiseReason(text, displayText);
}
