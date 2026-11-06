import 'server-only';
import { SPREAD_PRICE_LEVELS, type SpreadDimension, isPlainKey, spreadSetName } from '@tora/core';
import type { getTranslations } from 'next-intl/server';
import { LOCALES } from '@/i18n/locale';
import { loadMessages } from '@/i18n/messages';
import type { Money } from './money';

type T = Awaited<ReturnType<typeof getTranslations>>;

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();

/** A franchise typed by its name in any language ("ポケモン") read as its key (`pokemon`). */
export async function franchiseAliases() {
  const aliases = new Map<string, string>();
  for (const locale of LOCALES) {
    const names = ((await loadMessages(locale)) as { franchise?: Record<string, string> })
      .franchise;
    for (const [key, name] of Object.entries(names ?? {})) aliases.set(norm(name), key);
  }
  return (f: string | null) => (f ? (aliases.get(norm(f)) ?? f) : null);
}

/** The Items filter a Spread group opens: its URL param (the item type is `class`). */
export const SPREAD_PARAM: Record<SpreadDimension, string> = {
  type: 'class',
  franchise: 'franchise',
  set: 'set',
  era: 'era',
  price: 'price',
};

/** A group's name as Spread shows it ('' is the unknown group). */
export function spreadLabel(t: T, money: Money, d: SpreadDimension, key: string): string {
  if (key === '') return t(d === 'set' ? 'spread.noSet' : `spread.unknown.${d}`);
  // A key from the URL that names no text is shown as it is, never as a missing-text path.
  if (d === 'type') {
    return isPlainKey(key) && t.has(`sourceRoles.class.${key}`)
      ? t(`sourceRoles.class.${key}`)
      : key;
  }
  if (d === 'franchise') {
    return isPlainKey(key) && t.has(`franchise.${key}`) ? t(`franchise.${key}`) : key;
  }
  if (d === 'set') return spreadSetName(key);
  if (d === 'era') return key === 'before2016' ? t('spread.before2016') : key;
  if (!(SPREAD_PRICE_LEVELS as readonly string[]).includes(key)) return key;
  return t(`spread.price.${key}`, { a: money(1_000), b: money(10_000), c: money(100_000) });
}
