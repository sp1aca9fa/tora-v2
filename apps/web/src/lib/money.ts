import { currencyDigits, fromMinor, toMinor } from '@tora/core';

/** How amounts are shown (requirements S16): in the base currency the admin set. */
export interface MoneySettings {
  /** Every stored amount is in this currency's smallest unit. */
  base: string;
  /** The page's language ("en", "ja"): symbols and separators. */
  locale: string;
}

export interface Money {
  /** An amount stored in the base's smallest unit, for people ("¥5,400", "€12.50"). */
  (minor: number): string;
  base: string;
  /** The base's symbol, for amount inputs ("¥", "€"). */
  symbol: string;
  /** A stored amount as typed in an input (base, whole units: 1250 cents -> "12.5"). */
  input(minor: number | null | undefined): string;
  /** Typed text to the base's smallest unit; null when empty or not a number. */
  parse(text: string | null | undefined): number | null;
}

/**
 * Typed amount text to a number in whole units: "5400", "5,400", "¥5,400", "５４００", "12.50",
 * "12,50" (a comma before 1 or 2 final digits is a decimal comma); null when not a number.
 */
export function amountFromText(text: string | null | undefined): number | null {
  let t = (text ?? '')
    .trim()
    .replace(/[０-９．，]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥円€$£\s]|[A-Z]{3}/g, '');
  if (t === '') return null;
  t = /^\d+,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const formats = new Map<string, Intl.NumberFormat>();
const formatFor = (locale: string, currency: string) => {
  const key = `${locale}|${currency}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : locale, { style: 'currency', currency });
    formats.set(key, f);
  }
  return f;
};

export function makeMoney(settings: MoneySettings): Money {
  const { base, locale } = settings;
  const format = formatFor(locale, base);
  const money = ((minor: number) => format.format(fromMinor(minor, base))) as Money;
  money.base = base;
  money.symbol = format.formatToParts(0).find((p) => p.type === 'currency')?.value ?? base;
  money.input = (minor) =>
    minor == null ? '' : String(Number(fromMinor(minor, base).toFixed(currencyDigits(base))));
  money.parse = (text) => {
    const n = amountFromText(text);
    return n === null ? null : toMinor(n, base);
  };
  return money;
}
