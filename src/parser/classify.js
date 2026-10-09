import { classByName, keywordClasses } from "./keywords.js";
import {
  HEAD_WORDS, reRentalStrong, reRentalWeak, reSaleStrong, reSeekerVerb,
  reTypology, rePriceK, rePriceNum, reSpam, reMedia,
} from "./patterns.js";
import { containsAnyKeyword, firstNWords } from "./text.js";

export const classify = (text) => classifyWhy(text).category;

/** Category plus a human-readable (pt) reason, for the admin console. */
export function classifyWhy(text) {
  const lower = text.toLowerCase();
  const head = firstNWords(lower, HEAD_WORDS);

  if (reSeekerVerb.test(head)) return { category: "seeker", reason: "Começa com um verbo de procura (ex.: procuro, preciso)" };

  const headHasHome = !!containsAnyKeyword(head, classByName("home"));
  for (const cls of keywordClasses) {
    if (!cls.isOverride || !cls.verdict) continue;
    if (containsAnyKeyword(head, cls)) {
      if (cls.weakHome && headHasHome) continue;
      return { category: cls.verdict, reason: `Palavra-chave no início do texto (${cls.verdict === "noise" ? "não é anúncio de casa" : cls.verdict})` };
    }
  }

  if (reSaleStrong.test(lower)) return { category: "sale", reason: "Contém termos de venda (vende-se, à venda…)" };
  if (reRentalStrong.test(lower)) return { category: "rental", reason: "Contém termos de arrendamento (arrenda-se, aluga-se…)" };
  if (reRentalWeak.test(lower) && reTypology.test(text)) return { category: "rental", reason: "Fala de casa e tem tipologia (T1, T2…)" };
  if (headHasHome && (rePriceK.test(text) || rePriceNum.test(text))) return { category: "rental", reason: "Fala de casa e tem preço" };
  return { category: "noise", reason: "Sem palavras-chave de arrendamento, venda ou procura de casa" };
}

/** Why a message was dropped as noise before classification (or "" if it wasn't). */
export function noiseReason(text, displayText = "") {
  if (displayText.trim().startsWith(">")) return "Resposta citada";
  if (reMedia.test(text.trim())) return "Mensagem de mídia sem texto";
  if (reSpam.test(text)) return "Parece spam/publicidade (apostas, links…)";
  return "";
}

export function isNoise(text, displayText = "") {
  return (
    displayText.trim().startsWith(">") ||
    reMedia.test(text.trim()) ||
    reSpam.test(text)
  );
}
