import 'server-only';
import { baseCurrency } from '@tora/core';
import { type KeyOf, type NameOf, SHEET_COLUMNS, type SheetColumn, headerKey } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { LOCALES } from '@/i18n/locale';
import { getRegistry } from './sources';
import { withTaxonomy } from './taxonomy-messages';

/** Columns holding an amount: their header names the base currency. */
const AMOUNTS: SheetColumn[] = ['cost', 'value', 'profit', 'sold_for', 'fees'];

/** The lots spreadsheet's headers and names in the person's language (S6). */
export async function sheetLabels(): Promise<{
  header: (column: SheetColumn) => string;
  name: NameOf;
}> {
  const [t, registry] = await Promise.all([getTranslations(), getRegistry()]);
  const currency = baseCurrency(registry);
  return {
    header: (c) => {
      const label = t(`sheet.column.${c}`);
      return AMOUNTS.includes(c) ? `${label} (${currency})` : label;
    },
    name: (ns, key) => (t.has(`${ns}.${key}`) ? t(`${ns}.${key}`) : key),
  };
}

type Texts = Record<string, unknown>;
const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();
const at = (texts: Texts, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Texts | undefined)?.[k], texts);

/**
 * Reading a spreadsheet back (S6): headers and names in any installed language, or the keys
 * themselves, whatever language the person uses now.
 */
export async function sheetReader(): Promise<{
  column: (cell: string) => SheetColumn | null;
  keyOf: KeyOf;
}> {
  const registry = await getRegistry();
  const languages = await Promise.all(
    LOCALES.map(async (locale) => {
      const messages = (await import(`../../messages/${locale}.json`)).default as Texts;
      return registry.taxonomy ? withTaxonomy(messages, registry.taxonomy, locale) : messages;
    }),
  );
  const headers = new Map<string, SheetColumn>();
  for (const c of SHEET_COLUMNS) {
    headers.set(c, c);
    headers.set(c.replace(/_/g, ' '), c);
    for (const texts of languages) {
      const label = at(texts, `sheet.column.${c}`);
      if (typeof label === 'string') headers.set(headerKey(label), c);
    }
  }
  const sections = new Map<string, Map<string, string>>();
  const section = (ns: string) => {
    let names = sections.get(ns);
    if (!names) {
      names = new Map();
      for (const texts of languages) {
        const values = at(texts, ns);
        if (!values || typeof values !== 'object') continue;
        for (const [key, name] of Object.entries(values as Texts)) {
          names.set(norm(key), key);
          if (typeof name === 'string') names.set(norm(name), key);
        }
      }
      sections.set(ns, names);
    }
    return names;
  };
  return {
    column: (cell) => headers.get(headerKey(cell)) ?? null,
    keyOf: (ns, cell) => section(ns).get(norm(cell)) ?? null,
  };
}
