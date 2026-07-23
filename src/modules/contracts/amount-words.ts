const units = [
  ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
  ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
] as const;
const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function form(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 19) return many;
  const last = value % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

function triplet(value: number, feminine = false) {
  const parts: string[] = [];
  if (Math.floor(value / 100)) parts.push(hundreds[Math.floor(value / 100)]);
  const remainder = value % 100;
  if (remainder >= 10 && remainder < 20) parts.push(teens[remainder - 10]);
  else {
    if (Math.floor(remainder / 10)) parts.push(tens[Math.floor(remainder / 10)]);
    if (remainder % 10) parts.push(units[feminine ? 1 : 0][remainder % 10]);
  }
  return parts.filter(Boolean).join(" ");
}

function integerWords(value: number) {
  if (value === 0) return "ноль";
  if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999) {
    throw new Error("Amount is outside the supported RUB range.");
  }
  const parts: string[] = [];
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;
  if (millions) {
    parts.push(triplet(millions), form(millions, "миллион", "миллиона", "миллионов"));
  }
  if (thousands) {
    parts.push(triplet(thousands, true), form(thousands, "тысяча", "тысячи", "тысяч"));
  }
  if (rest) parts.push(triplet(rest));
  return parts.join(" ");
}

export function rublesInWords(amount: number) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid RUB amount.");
  const rounded = Math.round(amount * 100);
  const rubles = Math.floor(rounded / 100);
  const kopecks = rounded % 100;
  const words = integerWords(rubles);
  return `${words[0].toUpperCase()}${words.slice(1)} ${form(rubles, "рубль", "рубля", "рублей")} ${kopecks.toString().padStart(2, "0")} ${form(kopecks, "копейка", "копейки", "копеек")}`;
}
