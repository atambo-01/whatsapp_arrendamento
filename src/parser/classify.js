import { classByName, keywordClasses } from "./keywords.js";
import {
  HEAD_WORDS, reRentalStrong, reRentalWeak, reSaleStrong, reSeekerVerb,
  reTypology, rePriceK, rePriceNum, reSpam, reMedia,
} from "./patterns.js";
import { containsAnyKeyword, firstNWords } from "./text.js";

export function classify(text) {
  const lower = text.toLowerCase();
  const head = firstNWords(lower, HEAD_WORDS);

  if (reSeekerVerb.test(head)) return "seeker";

  const headHasHome = !!containsAnyKeyword(head, classByName("home"));
  for (const cls of keywordClasses) {
    if (!cls.isOverride || !cls.verdict) continue;
    if (containsAnyKeyword(head, cls)) {
      if (cls.weakHome && headHasHome) continue;
      return cls.verdict;
    }
  }

  if (reSaleStrong.test(lower)) return "sale";
  if (reRentalStrong.test(lower)) return "rental";
  if (reRentalWeak.test(lower) && reTypology.test(text)) return "rental";
  if (headHasHome && (rePriceK.test(text) || rePriceNum.test(text))) return "rental";
  return "noise";
}

export function isNoise(text, displayText = "") {
  return (
    displayText.trim().startsWith(">") ||
    reMedia.test(text.trim()) ||
    reSpam.test(text)
  );
}
