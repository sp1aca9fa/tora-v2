import {
  type Taxonomy,
  BUILT_IN_LISTS,
  categoryDef,
  conditionList,
  itemTypes,
  pickName,
} from '@tora/core';

type Messages = Record<string, unknown>;
type Texts = Record<string, unknown>;

/**
 * The admin's names for categories, kinds, item types, fields and condition values (S16), added
 * to a language's texts, so every `t('kind.x')` shows them: `category.{key}`, `kind.{key}`, `region.{key}`,
 * `sourceRoles.class.{type}`, `fieldIn.{category}.{field}`, `conditionValue.{list}.{value}`,
 * `conditionLists.{list}`. Built-in ones keep the translation files' texts unless renamed.
 */
export function withTaxonomy(messages: Messages, taxonomy: Taxonomy, locale: string): Messages {
  const section = (key: string): Texts => ({ ...((messages[key] as Texts | undefined) ?? {}) });
  const category = section('category');
  const region = section('region');
  const kind = section('kind');
  const roles = section('sourceRoles');
  const cls: Texts = { ...((roles.class as Texts | undefined) ?? {}) };
  const lists = section('conditionLists');
  const fieldIn: Texts = {};
  const conditionValue: Texts = {};
  const name = (names: Record<string, string> | undefined, texts: Texts, key: string) =>
    pickName(names, locale, typeof texts[key] === 'string' ? (texts[key] as string) : key);

  for (const c of taxonomy.categories) {
    category[c.key] = name(c.names, category, c.key);
    for (const k of c.kinds) kind[k.key] = name(k.names, kind, k.key);
    // The admin's own regions, and built-in ones they renamed (S10).
    for (const [key, names] of Object.entries(c.regionNames ?? {}))
      region[key] = name(names, region, key);
    const fields: Texts = {};
    for (const f of c.fields) if (f.names) fields[f.key] = pickName(f.names, locale, f.key);
    fieldIn[c.key] = fields;
  }
  for (const l of taxonomy.lists) {
    lists[l.key] = name(l.names, lists, l.key);
    if (BUILT_IN_LISTS.some((b) => b.key === l.key)) continue;
    conditionValue[l.key] = Object.fromEntries(
      l.values.map((v) => [v.key, pickName(v.names, locale, v.key)]),
    );
  }
  for (const t of itemTypes(taxonomy)) {
    if (typeof cls[t.key] === 'string') continue;
    const c = category[t.category] ?? categoryDef(taxonomy, t.category)?.key ?? t.category;
    cls[t.key] = t.alone ? c : `${c} · ${lists[t.list] ?? conditionList(taxonomy, t.list)?.key}`;
  }
  return {
    ...messages,
    category,
    kind,
    region,
    sourceRoles: { ...roles, class: cls },
    conditionLists: lists,
    fieldIn,
    conditionValue,
  };
}
