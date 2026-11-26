import {
  type CategoryDef,
  type ConditionList,
  type FieldDef,
  type Names,
  REGIONS,
  RESERVED_LIST_KEYS,
  STANDARD_FIELDS,
  type Taxonomy,
} from '@tora/core';

/*
 * Keys of the admin's categories (`docs/categories.md`, "Keys"): made when something is first
 * saved and never changed, since stored data uses them. A key saved before this edit stays taken
 * even when its item is removed in the same edit: a new item on the removed key would be read as
 * the old one, and its lots and stored prices would follow it (G46). The lists' reserved bucket
 * prefixes (`raw`, `graded`, `cond`, the built-in lists) are never a new list's key: the server
 * drops such a list (G47).
 */

/** A key from a name ("Booster box" -> "booster_box"), unique among `taken`. */
export function keyFrom(name: string, taken: readonly string[], fallback: string): string {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'x$1')
      .slice(0, 30) || fallback;
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
}

/** The name a key is made from: English if typed, else the first name. */
export const keyName = (names: Names | undefined) =>
  names?.en?.trim() || Object.values(names ?? {}).find((n) => n.trim()) || '';

const keys = (items: readonly { key: string }[] | undefined) => (items ?? []).map((x) => x.key);

/** The draft key of a new list (until the save names it): never a saved or reserved one. */
export const newListKey = (saved: Taxonomy, draft: Taxonomy) =>
  keyFrom(
    '',
    [...RESERVED_LIST_KEYS, ...keys(saved.lists), ...keys(draft.lists)],
    `list${draft.lists.filter((l) => !l.builtIn).length + 1}`,
  );

/** The draft key of a new value in `list`: never one its saved list had. */
export const newValueKey = (saved: Taxonomy, list: ConditionList) =>
  keyFrom(
    '',
    [...keys(saved.lists.find((l) => l.key === list.key)?.values), ...keys(list.values)],
    `value${list.values.length + 1}`,
  );

/** The draft key of a new category: never a saved one. */
export const newCategoryKey = (saved: Taxonomy, draft: Taxonomy) =>
  keyFrom(
    '',
    [...keys(saved.categories), ...keys(draft.categories)],
    `category${draft.categories.length + 1}`,
  );

/** The draft key of a new kind in `category`: never one its saved category had. */
export const newKindKey = (saved: CategoryDef | undefined, category: CategoryDef) =>
  keyFrom('', [...keys(saved?.kinds), ...keys(category.kinds)], `kind${category.kinds.length + 1}`);

/** The draft key of a new field in `category`: never a saved or standard one. */
export const newFieldKey = (saved: CategoryDef | undefined, category: CategoryDef) =>
  keyFrom(
    '',
    [
      ...keys(saved?.fields),
      ...keys(category.fields),
      ...STANDARD_FIELDS.map((s) => s.toLowerCase()),
    ],
    `field${category.fields.length + 1}`,
  );

/** The draft key of a new choice of `field`: never one its saved field had. */
export const newChoiceKey = (saved: FieldDef | undefined, field: FieldDef) =>
  keyFrom(
    '',
    [...keys(saved?.choices), ...keys(field.choices)],
    `choice${(field.choices?.length ?? 0) + 1}`,
  );

/** The draft key of a new region in `category`: never a saved or built-in one. */
export const newRegionKey = (saved: CategoryDef | undefined, category: CategoryDef) =>
  keyFrom(
    '',
    [...(saved?.regions ?? []), ...(category.regions ?? []), ...REGIONS],
    `region${(category.regions?.length ?? 0) + 1}`,
  );

/**
 * Gives what is new since the last save keys made from its names (they show in plug-ins' buckets,
 * e.g. `watch_condition:unworn`), and points kinds and fields at the new keys.
 */
export function withNamedKeys(draft: Taxonomy, saved: Taxonomy): Taxonomy {
  const oldLists = new Map(saved.lists.map((l) => [l.key, l]));
  const listKeys = new Map<string, string>();
  const takenLists = [...RESERVED_LIST_KEYS, ...saved.lists.map((l) => l.key)];
  const lists = draft.lists.map((l) => {
    if (l.builtIn) return l;
    const before = oldLists.get(l.key);
    const key = before ? l.key : keyFrom(keyName(l.names), takenLists, l.key);
    takenLists.push(key);
    listKeys.set(l.key, key);
    const taken = before?.values.map((v) => v.key) ?? [];
    const values = l.values.map((v) => {
      if (before?.values.some((x) => x.key === v.key)) return v;
      const vk = keyFrom(keyName(v.names), taken, v.key);
      taken.push(vk);
      return { ...v, key: vk };
    });
    return { ...l, key, values };
  });
  const takenCategories = saved.categories.map((c) => c.key);
  const categories = draft.categories.map((c) => {
    const before = saved.categories.find((x) => x.key === c.key);
    const key = before ? c.key : keyFrom(keyName(c.names), takenCategories, c.key);
    takenCategories.push(key);
    const kindKeys = new Map<string, string>();
    const takenKinds = before?.kinds.map((k) => k.key) ?? [];
    const kinds = c.kinds.map((k) => {
      const kk = before?.kinds.some((x) => x.key === k.key)
        ? k.key
        : keyFrom(keyName(k.names), takenKinds, k.key);
      takenKinds.push(kk);
      kindKeys.set(k.key, kk);
      return { ...k, key: kk, conditions: listKeys.get(k.conditions) ?? k.conditions };
    });
    const takenFields = [
      ...(before?.fields.map((f) => f.key) ?? []),
      ...STANDARD_FIELDS.map((f) => f.toLowerCase()),
    ];
    const fields = c.fields.map((f) => {
      const known = f.standard || before?.fields.some((x) => x.key === f.key);
      const fk = known ? f.key : keyFrom(keyName(f.names), takenFields, f.key);
      takenFields.push(fk);
      const beforeField = before?.fields.find((x) => x.key === f.key);
      const takenChoices = beforeField?.choices?.map((x) => x.key) ?? [];
      const choices = f.choices?.map((ch) => {
        if (beforeField?.choices?.some((x) => x.key === ch.key)) return ch;
        const ck = keyFrom(keyName(ch.names), takenChoices, ch.key);
        takenChoices.push(ck);
        return { ...ch, key: ck };
      });
      return {
        ...f,
        key: fk,
        ...(choices ? { choices } : {}),
        ...(f.kinds ? { kinds: f.kinds.map((k) => kindKeys.get(k) ?? k) } : {}),
      };
    });
    // New regions: keys from their names too (S10), their names moved along.
    const takenRegions = [...(before?.regions ?? []), ...REGIONS];
    const regionNames: Record<string, Names> = {};
    const regions = c.regions?.map((r) => {
      const rk =
        before?.regions?.includes(r) || (REGIONS as readonly string[]).includes(r)
          ? r
          : keyFrom(keyName(c.regionNames?.[r]), takenRegions, r);
      takenRegions.push(rk);
      if (c.regionNames?.[r]) regionNames[rk] = c.regionNames[r];
      return rk;
    });
    return {
      ...c,
      key,
      kinds,
      fields,
      ...(regions ? { regions } : {}),
      ...(Object.keys(regionNames).length ? { regionNames } : { regionNames: undefined }),
    };
  });
  return { categories, lists };
}
