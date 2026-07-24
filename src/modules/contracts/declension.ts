import { classifySignerAuthority } from "@/modules/extraction/authority";

export type DeclensionOutcome =
  | { reliable: true; value: string }
  | { reliable: false; value: null };

function reliable(value: string): DeclensionOutcome {
  return { reliable: true, value };
}

function unreliable(): DeclensionOutcome {
  return { reliable: false, value: null };
}

function normalize(value: unknown) {
  // Deliberately no NFKC here (unlike classifySignerAuthority's own internal
  // normalization): NFKC decomposes "№" into "N"+"o", which would corrupt
  // the power-of-attorney/order number text we splice back untouched below.
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

// Closed dictionary of job titles with a KNOWN, verified genitive form.
// Anything not listed here is left unreliable — titles are far too varied
// (adjective agreement, irregular nouns) to decline generically without
// risking a silently wrong contract preamble.
const POSITION_GENITIVE: Record<string, string> = {
  "генеральный директор": "генерального директора",
  "директор": "директора",
  "исполнительный директор": "исполнительного директора",
  "коммерческий директор": "коммерческого директора",
  "финансовый директор": "финансового директора",
  "технический директор": "технического директора",
  "управляющий": "управляющего",
  "президент": "президента",
  "председатель правления": "председателя правления",
  "председатель совета директоров": "председателя совета директоров",
  "индивидуальный предприниматель": "индивидуального предпринимателя",
};

export function declineSignerPositionGenitive(position: unknown): DeclensionOutcome {
  const normalized = normalize(position).toLocaleLowerCase("ru-RU");
  const known = POSITION_GENITIVE[normalized];
  return known ? reliable(known) : unreliable();
}

// Closed dictionary of common Russian masculine given names with a KNOWN
// genitive form. First names are the least regular part of a full name
// (Никита, Илья, Данила behave like feminine-pattern nouns; others are
// fully regular) — a whitelist avoids ever guessing wrong.
const GIVEN_NAME_GENITIVE: Record<string, string> = {
  "александр": "александра", "алексей": "алексея", "анатолий": "анатолия",
  "андрей": "андрея", "антон": "антона", "аркадий": "аркадия",
  "артём": "артёма", "артем": "артема", "борис": "бориса",
  "вадим": "вадима", "валентин": "валентина", "валерий": "валерия",
  "василий": "василия", "виктор": "виктора", "виталий": "виталия",
  "владимир": "владимира", "владислав": "владислава", "вячеслав": "вячеслава",
  "геннадий": "геннадия", "георгий": "георгия", "герман": "германа",
  "григорий": "григория", "даниил": "даниила", "данила": "данилы",
  "денис": "дениса", "дмитрий": "дмитрия", "евгений": "евгения",
  "егор": "егора", "иван": "ивана", "игнат": "игната", "игорь": "игоря",
  "илья": "ильи", "кирилл": "кирилла", "константин": "константина",
  "леонид": "леонида", "максим": "максима", "матвей": "матвея",
  "михаил": "михаила", "никита": "никиты", "николай": "николая",
  "олег": "олега", "павел": "павла", "пётр": "петра", "петр": "петра",
  "роман": "романа", "руслан": "руслана", "святослав": "святослава",
  "семён": "семёна", "семен": "семена", "сергей": "сергея",
  "станислав": "станислава", "степан": "степана", "тимофей": "тимофея",
  "тимур": "тимура", "фёдор": "фёдора", "федор": "федора", "эдуард": "эдуарда",
  "юрий": "юрия", "ярослав": "ярослава",
};

// Regular declension for masculine patronymics: every standard Russian
// masculine patronymic ends in "-ович"/"-евич"/"-ич" and genitivizes by
// appending "а" — no known exceptions, safe to apply generically.
function declinePatronymic(value: string): string | null {
  if (/(ович|евич|ич)$/iu.test(value)) return `${value}а`;
  return null;
}

// Regular declension for the overwhelming majority of Russian masculine
// surnames (the "-ов/-ев/-ёв/-ин/-ын" pattern, e.g. Иванов, Петров,
// Кузнецов, Пушкин). Adjectival surnames ("-ский/-цкий", e.g. Высоцкий)
// decline like adjectives. Anything else is left unreliable.
function declineSurname(value: string): string | null {
  if (/(ский|цкий)$/iu.test(value)) return value.replace(/(ский|цкий)$/iu, (match) => `${match.slice(0, -2)}ого`);
  if (/(ов|ев|ёв|ин|ын)$/iu.test(value)) return `${value}а`;
  return null;
}

// "Фамилия Имя Отчество" — every part must decline reliably or the whole
// name is left unreliable (never mix a declined part with a guessed one).
export function declineSignerNameGenitive(fullName: unknown): DeclensionOutcome {
  const normalized = normalize(fullName);
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length !== 3) return unreliable();
  const [surname, given, patronymic] = parts;
  const declinedSurname = declineSurname(surname);
  const declinedGiven = GIVEN_NAME_GENITIVE[given.toLocaleLowerCase("ru-RU")];
  const declinedPatronymic = declinePatronymic(patronymic);
  if (!declinedSurname || !declinedGiven || !declinedPatronymic) return unreliable();
  const givenCased = matchCase(given, declinedGiven);
  return reliable([
    matchCase(surname, declinedSurname),
    givenCased,
    matchCase(patronymic, declinedPatronymic),
  ].join(" "));
}

function matchCase(source: string, declined: string) {
  if (!source) return declined;
  const firstLetterUpper = source[0] === source[0].toLocaleUpperCase("ru-RU") && /[а-яё]/iu.test(source[0]);
  return firstLetterUpper
    ? declined.charAt(0).toLocaleUpperCase("ru-RU") + declined.slice(1)
    : declined;
}

// signer_authority reuses the same charter/power-of-attorney/order
// classification already used to derive authority_document — only the
// three known bases decline reliably; free-text bases are left unreliable.
export function declineSignerAuthorityGenitive(authority: unknown): DeclensionOutcome {
  const normalized = normalize(authority);
  if (!normalized) return unreliable();
  const classification = classifySignerAuthority(normalized);
  if (classification === "charter") {
    // "Устав" is the only word in this basis — a single regular masculine
    // noun ending in a hard consonant, genitive adds "а".
    if (normalized.toLocaleLowerCase("ru-RU") !== "устав") return unreliable();
    return reliable(matchCase(normalized, "устава"));
  }
  if (classification === "power_of_attorney") {
    // Note: a trailing `\b` would silently fail here — JS treats Cyrillic
    // letters as non-word characters, so `\b` right after "доверенность"
    // never matches. Use an explicit non-letter/end-of-string lookahead.
    const match = /^(доверенности|доверенность)(?![а-яё])/iu.exec(normalized);
    if (!match) return unreliable();
    return reliable(`${matchCase(match[0], "доверенности")}${normalized.slice(match[0].length)}`);
  }
  if (classification === "order") {
    const match = /^приказ[а]?(?![а-яё])/iu.exec(normalized);
    if (!match) return unreliable();
    return reliable(`${matchCase(match[0], "приказа")}${normalized.slice(match[0].length)}`);
  }
  return unreliable();
}
