// Regex patterns for the Portuguese-language listing parser.
export const RENTAL_MIN = 15000;
export const RENTAL_MAX = 700000;
export const SALE_MIN = 1000000;
export const SALE_MAX = 50000000;
export const HEAD_WORDS = 10;
export const TYPOLOGY_HEAD_WORDS = 20;

export const reRentalStrong = new RegExp(
  "(" +
    "arrenda[\\s\\-]?se|arrendam[\\s\\-]?se|aluga[\\s\\-]?se|alugam[\\s\\-]?se|" +
    "\\barrendo\\b|\\barrendam\\b|\\balugo\\b|\\balugam\\b|" +
    "\\baluguei\\b|\\barrendei\\b|\\balugando\\b|\\barrendando\\b|" +
    "\\bestou a alugar\\b|\\bestou alugando\\b|\\bestou a arrendar\\b|\\bestou arrendando\\b|" +
    "\\bestamos a alugar\\b|\\bestamos alugando\\b|" +
    "\\btemos para alugar\\b|\\btemos para arrendar\\b|" +
    "\\bpara aluguer\\b|\\bpara aluguel\\b|\\bpara arrendar\\b|\\bpara arrendamento\\b|" +
    "\\bem arrendamento\\b|\\bem aluguer\\b|" +
    "\\barrendamento\\b|\\baluguer\\b|\\baluguel\\b" +
    ")",
  "i",
);

export const reRentalWeak =
  /(\barrenda\b|\barrendas\b|\barrendar\b|\baluga\b|\balugas\b|\balugar\b)/i;

export const reSeekerVerb = new RegExp(
  "(" +
    "\\bprocuro\\b|\\bprocuramos\\b|\\bprocurando\\b|\\bprocura[\\s\\-]?se\\b|" +
    "\\bestou (à|a|em)? ?procura\\b|\\bando (à|a)? ?procura\\b|" +
    "\\bestou a procurar\\b|\\bestou procurando\\b|" +
    "\\bpreciso (de|duma|dum|duns|dumas|um|uma)\\b|" +
    "\\bprecisamos (de|duma|dum|um|uma)\\b|" +
    "\\bquero (uma|um|uns|umas|comprar|arrendar|alugar)\\b|" +
    "\\bqueremos (uma|um|comprar)\\b|" +
    "\\balgu[eé]m tem\\b|\\balgu[eé]m sabe\\b|\\balgu[eé]m arranja\\b|\\balgu[eé]m conhece\\b|" +
    "\\bquem tem\\b|\\bquem sabe\\b|\\bquem arranja\\b|\\bquem conhece\\b|" +
    "\\barranja[\\s\\-]?se\\b|\\barranjem\\b|" +
    "\\bnecessito (de|duma|dum|um|uma)\\b|\\bnecessitamos (de|duma|dum)\\b|" +
    "\\btou à procura\\b|\\btou a procura\\b|" +
    "\\bsolicito\\b|\\bsolicitaç" +
    ")",
  "i",
);

export const reSaleStrong = new RegExp(
  "(" +
    "\\bvende[\\s\\-]?se\\b|\\bvendem[\\s\\-]?se\\b|\\bvendo\\b|\\bvendemos\\b|" +
    "à venda|para venda|está à venda|está para vender|" +
    "\\bvenda de\\b|\\bem venda\\b|\\bquero vender\\b|\\bpretendo vender\\b|" +
    "\\bvenda urgente\\b|\\bem construção\\b" +
    ")",
  "i",
);

// Strong typology always counts; generic words only count in the head zone.
export const reTypology = new RegExp(
  "\\b(" +
    "T[\\s\\-]?[0-9]|V[\\s\\-]?[0-9]|duplex|triplex|" +
    "apartamento|apart|apº|apto|vivenda|moradia|villa|" +
    "kitnet|kit[\\s\\-]?net|flat|studio|estúdio|residencial" +
    ")\\b",
  "i",
);
export const reTypologyGeneric =
  /\b(casa|quarto|terreno|lote|loja|quinta|armazém|armazem)\b/i;

export const reURL = /https?:\/\/\S+|www\.\S+/gi;

const UNITS = "milh(?:ão|ões|ao|oes)|mil|kzs?|k\\b|akz|aoa|usd|\\$|m\\b";
export const rePriceK = new RegExp(
  "(\\d{1,3}(?:[.,\\s]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?\\s*['\\x60]?\\s*(" + UNITS + ")",
  "i",
);
export const rePriceNum = new RegExp(
  "(?:plafond|plafon|pre[çc]o|valor|renda|mensalidade|por m[êe]s|mensal)\\s*[:\\-]?\\s*" +
    "(\\d{1,3}(?:[.,\\s]\\d{3})*|\\d+)(?:[.,]\\d{1,2})?\\s*(" + UNITS + ")?",
  "i",
);

export const rePhone = /\b(?:9\d{2}[\s-]?\d{3}[\s-]?\d{3}|9\d{8})\b/;
export const reSpam =
  /(kwanzabet|shopee\.com\.br|chat vip|affiliates\/?btag|wa\.me\/message|bet\s?\d|cassino|aposta|viga\s+\d+|delay\s+spray)/i;
export const reMedia =
  /^(sent (image|video|audio|sticker|document)|\(message\)|image|video|audio)$/i;
export const reWord = /[A-Za-zÀ-ÿ0-9]+/g;
