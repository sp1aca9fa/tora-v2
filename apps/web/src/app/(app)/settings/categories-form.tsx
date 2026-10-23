'use client';

import {
  type CategoryDef,
  type ConditionList,
  FIELD_TYPES,
  type FieldDef,
  type FieldType,
  type Names,
  REGIONS,
  STANDARD_FIELDS,
  type Taxonomy,
  pickName,
} from '@tora/core';
import type { CategoryUsage } from '@tora/db';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { type CategoriesState, saveCategoriesAction } from './actions';

/** A key from a name ("Booster box" -> "booster_box"), unique among `taken`. */
function keyFrom(name: string, taken: string[], fallback: string): string {
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
const keyName = (names: Names | undefined) =>
  names?.en?.trim() || Object.values(names ?? {}).find((n) => n.trim()) || '';

/**
 * Gives what is new since the last save keys made from its names (they show in plug-ins' buckets,
 * e.g. `watch_condition:unworn`), and points kinds and fields at the new keys.
 */
function withNamedKeys(draft: Taxonomy, saved: Taxonomy): Taxonomy {
  const oldLists = new Map(saved.lists.map((l) => [l.key, l]));
  const listKeys = new Map<string, string>();
  const takenLists = saved.lists.map((l) => l.key);
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

const move = <T,>(list: T[], i: number, step: number): T[] => {
  const j = i + step;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

/**
 * The admin's categories (S16): names in the app's two languages, kinds with their condition list,
 * standard and custom fields, and the admin's own condition lists. Saved together; a change that
 * touches registered items says how many first.
 */
export function CategoriesForm({
  taxonomy,
  usage,
  languages,
}: {
  taxonomy: Taxonomy;
  usage: CategoryUsage;
  /** The app's languages: names are typed in each. */
  languages: string[];
}) {
  const t = useTranslations('categories');
  const tAll = useTranslations();
  const locale = useLocale();
  const [draft, setDraft] = useState<Taxonomy>(taxonomy);
  const [state, setState] = useState<CategoriesState>({});
  const [pending, startTransition] = useTransition();
  const saved = new Set(taxonomy.categories.map((c) => c.key));
  const savedLists = new Set(taxonomy.lists.map((l) => l.key));
  const own = draft.lists.filter((l) => !l.builtIn);
  const dirty = JSON.stringify(draft) !== JSON.stringify(taxonomy);

  // Built-in names come from the app's texts; the admin's from what they typed.
  const listName = (l: ConditionList) =>
    pickName(
      l.names,
      locale,
      tAll.has(`conditionLists.${l.key}`) ? tAll(`conditionLists.${l.key}`) : l.key,
    );
  const categoryName = (c: CategoryDef) =>
    pickName(c.names, locale, tAll.has(`category.${c.key}`) ? tAll(`category.${c.key}`) : c.key);

  const setCategory = (key: string, change: (c: CategoryDef) => CategoryDef) =>
    setDraft((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.key === key ? change(c) : c)),
    }));
  const setList = (key: string, change: (l: ConditionList) => ConditionList) =>
    setDraft((d) => ({ ...d, lists: d.lists.map((l) => (l.key === key ? change(l) : l)) }));

  const save = (confirmed: boolean) =>
    startTransition(async () => {
      const result = await saveCategoriesAction(withNamedKeys(draft, taxonomy), confirmed);
      if (result.touched?.length && !confirmed) {
        const lines = result.touched.map((x) =>
          t(`touched.${x.code}`, { name: x.name, count: x.count }),
        );
        if (window.confirm(`${t('confirm')}\n\n${lines.join('\n')}`)) save(true);
        return;
      }
      setState(result);
      if (result.saved) setDraft(result.saved);
    });

  /** Name inputs, one per app language. */
  const namesInput = (names: Names | undefined, onChange: (n: Names) => void, label: string) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {languages.map((lang) => (
        <Input
          key={lang}
          lang={lang}
          aria-label={`${label} (${lang})`}
          placeholder={`${label} (${lang})`}
          value={names?.[lang] ?? ''}
          onChange={(e) => onChange({ ...names, [lang]: e.target.value })}
          className="h-9"
        />
      ))}
    </div>
  );

  const iconButton =
    'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30';

  return (
    <div className={cn('space-y-6 text-sm', pending && 'opacity-60')}>
      <section className="space-y-3">
        {draft.categories.map((c) => {
          const items = usage.categories[c.key] ?? 0;
          return (
            <details key={c.key} className="rounded-lg border" open={!saved.has(c.key)}>
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
                <span className="font-medium">
                  {categoryName(c)}
                  {c.hidden && (
                    <span className="ml-2 text-xs text-muted-foreground">{t('hiddenBadge')}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('items', { count: items })}
                </span>
              </summary>
              <div className="space-y-4 border-t px-3 py-3">
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {saved.has(c.key) ? t('key', { key: c.key }) : t('newKey')}
                  </p>
                  {namesInput(
                    c.names,
                    (names) => setCategory(c.key, (x) => ({ ...x, names })),
                    t('name'),
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!c.hidden}
                      onChange={(e) =>
                        setCategory(c.key, (x) => ({ ...x, hidden: e.target.checked }))
                      }
                      className="size-4"
                    />
                    {t('hidden')}
                  </label>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('kinds')}
                  </h3>
                  {c.kinds.map((k, i) => {
                    const used = usage.kinds[`${c.key}/${k.key}`] ?? 0;
                    return (
                      <div key={k.key} className="space-y-2 rounded-md bg-muted/40 p-2">
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {pickName(
                              k.names,
                              locale,
                              tAll.has(`kind.${k.key}`) ? tAll(`kind.${k.key}`) : k.key,
                            )}
                            {' · '}
                            {t('items', { count: used })}
                          </span>
                          <span className="flex items-center">
                            <button
                              type="button"
                              className={iconButton}
                              aria-label={t('up')}
                              disabled={i === 0}
                              onClick={() =>
                                setCategory(c.key, (x) => ({ ...x, kinds: move(x.kinds, i, -1) }))
                              }
                            >
                              <ChevronUp className="size-4" />
                            </button>
                            <button
                              type="button"
                              className={iconButton}
                              aria-label={t('down')}
                              disabled={i === c.kinds.length - 1}
                              onClick={() =>
                                setCategory(c.key, (x) => ({ ...x, kinds: move(x.kinds, i, 1) }))
                              }
                            >
                              <ChevronDown className="size-4" />
                            </button>
                            <button
                              type="button"
                              className={iconButton}
                              aria-label={t('remove')}
                              title={used ? t('inUse') : t('remove')}
                              disabled={used > 0}
                              onClick={() =>
                                setCategory(c.key, (x) => ({
                                  ...x,
                                  kinds: x.kinds.filter((y) => y.key !== k.key),
                                }))
                              }
                            >
                              <X className="size-4" />
                            </button>
                          </span>
                        </div>
                        {namesInput(
                          k.names,
                          (names) =>
                            setCategory(c.key, (x) => ({
                              ...x,
                              kinds: x.kinds.map((y) => (y.key === k.key ? { ...y, names } : y)),
                            })),
                          t('kindName'),
                        )}
                        <div className="flex flex-wrap items-center gap-3">
                          <NativeSelect
                            aria-label={t('conditionList')}
                            value={k.conditions}
                            onChange={(e) =>
                              setCategory(c.key, (x) => ({
                                ...x,
                                kinds: x.kinds.map((y) =>
                                  y.key === k.key ? { ...y, conditions: e.target.value } : y,
                                ),
                              }))
                            }
                            className="h-9 w-full sm:w-72"
                          >
                            {draft.lists.map((l) => (
                              <option key={l.key} value={l.key}>
                                {listName(l)}
                              </option>
                            ))}
                          </NativeSelect>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!!k.hidden}
                              onChange={(e) =>
                                setCategory(c.key, (x) => ({
                                  ...x,
                                  kinds: x.kinds.map((y) =>
                                    y.key === k.key ? { ...y, hidden: e.target.checked } : y,
                                  ),
                                }))
                              }
                              className="size-4"
                            />
                            {t('hidden')}
                          </label>
                        </div>
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCategory(c.key, (x) => ({
                        ...x,
                        kinds: [
                          ...x.kinds,
                          {
                            key: keyFrom(
                              '',
                              x.kinds.map((y) => y.key),
                              `kind${x.kinds.length + 1}`,
                            ),
                            names: {},
                            conditions: 'item_condition',
                          },
                        ],
                      }))
                    }
                  >
                    <Plus className="size-4" />
                    {t('addKind')}
                  </Button>
                </div>

                <FieldsEditor
                  category={c}
                  usage={usage}
                  namesInput={namesInput}
                  onChange={(fields) => setCategory(c.key, (x) => ({ ...x, fields }))}
                />

                <RegionsEditor
                  category={c}
                  usage={usage}
                  namesInput={namesInput}
                  onChange={(regions, regionNames) =>
                    setCategory(c.key, (x) => ({ ...x, regions, regionNames }))
                  }
                />

                {!saved.has(c.key) || items === 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        categories: d.categories.filter((x) => x.key !== c.key),
                      }))
                    }
                  >
                    {t('removeCategory')}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('cannotRemove')}</p>
                )}
              </div>
            </details>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              categories: [
                ...d.categories,
                {
                  key: keyFrom(
                    '',
                    d.categories.map((c) => c.key),
                    `category${d.categories.length + 1}`,
                  ),
                  names: {},
                  kinds: [],
                  fields: [],
                },
              ],
            }))
          }
        >
          <Plus className="size-4" />
          {t('addCategory')}
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">{t('lists')}</h2>
        <p className="text-xs text-muted-foreground">{t('listsInfo')}</p>
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {draft.lists
            .filter((l) => l.builtIn)
            .map((l) => (
              <li key={l.key}>{listName(l)}</li>
            ))}
        </ul>
        {own.map((l) => {
          const usedBy = draft.categories.some((c) => c.kinds.some((k) => k.conditions === l.key));
          return (
            <div key={l.key} className="space-y-2 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {savedLists.has(l.key) ? t('key', { key: l.key }) : t('newKey')}
              </p>
              {namesInput(
                l.names,
                (names) => setList(l.key, (x) => ({ ...x, names })),
                t('listName'),
              )}
              <p className="text-xs text-muted-foreground">{t('valuesInfo')}</p>
              {l.values.map((v, i) => {
                const lots = usage.values[`${l.key}/${v.key}`] ?? 0;
                return (
                  <div key={v.key} className="space-y-2 rounded-md bg-muted/40 p-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {i + 1}. {pickName(v.names, locale, v.key)} · {t('lots', { count: lots })}
                      </span>
                      <span className="flex items-center">
                        <button
                          type="button"
                          className={iconButton}
                          aria-label={t('up')}
                          disabled={i === 0}
                          onClick={() =>
                            setList(l.key, (x) => ({ ...x, values: move(x.values, i, -1) }))
                          }
                        >
                          <ChevronUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          className={iconButton}
                          aria-label={t('down')}
                          disabled={i === l.values.length - 1}
                          onClick={() =>
                            setList(l.key, (x) => ({ ...x, values: move(x.values, i, 1) }))
                          }
                        >
                          <ChevronDown className="size-4" />
                        </button>
                        <button
                          type="button"
                          className={iconButton}
                          aria-label={t('remove')}
                          onClick={() =>
                            setList(l.key, (x) => ({
                              ...x,
                              values: x.values.filter((y) => y.key !== v.key),
                            }))
                          }
                        >
                          <X className="size-4" />
                        </button>
                      </span>
                    </div>
                    {namesInput(
                      v.names,
                      (names) =>
                        setList(l.key, (x) => ({
                          ...x,
                          values: x.values.map((y) => (y.key === v.key ? { ...y, names } : y)),
                        })),
                      t('valueName'),
                    )}
                    <Input
                      aria-label={t('pool')}
                      placeholder={t('pool')}
                      value={v.pool ?? ''}
                      onChange={(e) =>
                        setList(l.key, (x) => ({
                          ...x,
                          values: x.values.map((y) =>
                            y.key === v.key ? { ...y, pool: e.target.value.trim() || null } : y,
                          ),
                        }))
                      }
                      className="h-9 sm:w-72"
                    />
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setList(l.key, (x) => ({
                      ...x,
                      values: [
                        ...x.values,
                        {
                          key: keyFrom(
                            '',
                            x.values.map((y) => y.key),
                            `value${x.values.length + 1}`,
                          ),
                          names: {},
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="size-4" />
                  {t('addValue')}
                </Button>
                {!usedBy && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      setDraft((d) => ({ ...d, lists: d.lists.filter((x) => x.key !== l.key) }))
                    }
                  >
                    {t('removeList')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              lists: [
                ...d.lists,
                {
                  key: keyFrom(
                    '',
                    [...savedLists, ...d.lists.map((l) => l.key)],
                    `list${own.length + 1}`,
                  ),
                  names: {},
                  values: [],
                },
              ],
            }))
          }
        >
          <Plus className="size-4" />
          {t('addList')}
        </Button>
      </section>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 md:bottom-4">
        <Button type="button" disabled={!dirty || pending} onClick={() => save(false)}>
          {t('save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || pending}
          onClick={() => {
            setDraft(taxonomy);
            setState({});
          }}
        >
          {t('undo')}
        </Button>
        {state.blocked?.length ? (
          <p className="text-xs text-destructive">
            {state.blocked.map((b) => t(`blocked.${b}`)).join(' ')}
          </p>
        ) : state.saved ? (
          <p className="text-xs text-muted-foreground">{t('saved')}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A category's regions (S10): print languages, game regions, a record's pressing country... in
 * order (the first is the default when an import cannot tell). Built-in ones keep the app's
 * names unless renamed; removing one in use clears it from those items (asked first on save).
 */
function RegionsEditor({
  category,
  usage,
  namesInput,
  onChange,
}: {
  category: CategoryDef;
  usage: CategoryUsage;
  namesInput: (names: Names | undefined, onChange: (n: Names) => void, label: string) => ReactNode;
  onChange: (regions: string[], regionNames: Record<string, Names> | undefined) => void;
}) {
  const t = useTranslations('categories');
  const tAll = useTranslations();
  const locale = useLocale();
  const regions = category.regions ?? [];
  const names = category.regionNames ?? {};
  const set = (next: string[], nextNames: Record<string, Names> = names) =>
    onChange(next, Object.keys(nextNames).length ? nextNames : undefined);
  const iconButton =
    'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30';
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('regions')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('regionsInfo')}</p>
      {regions.map((r, i) => {
        const used = usage.regions[`${category.key}/${r}`] ?? 0;
        return (
          <div key={r} className="space-y-2 rounded-md bg-muted/40 p-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {pickName(names[r], locale, tAll.has(`region.${r}`) ? tAll(`region.${r}`) : r)}
                {' · '}
                {t('items', { count: used })}
              </span>
              <span className="flex items-center">
                <button
                  type="button"
                  className={iconButton}
                  aria-label={t('up')}
                  disabled={i === 0}
                  onClick={() => set(move(regions, i, -1))}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label={t('down')}
                  disabled={i === regions.length - 1}
                  onClick={() => set(move(regions, i, 1))}
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label={t('remove')}
                  onClick={() => {
                    const { [r]: _, ...rest } = names;
                    set(
                      regions.filter((x) => x !== r),
                      rest,
                    );
                  }}
                >
                  <X className="size-4" />
                </button>
              </span>
            </div>
            {namesInput(names[r], (n) => set(regions, { ...names, [r]: n }), t('regionName'))}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => set([...regions, keyFrom('', regions, `region${regions.length + 1}`)])}
      >
        <Plus className="size-4" />
        {t('addRegion')}
      </Button>
    </div>
  );
}

/** A category's fields: standard ones switched on, the admin's own, each for some or every kind. */
function FieldsEditor({
  category,
  usage,
  namesInput,
  onChange,
}: {
  category: CategoryDef;
  usage: CategoryUsage;
  namesInput: (
    names: Names | undefined,
    onChange: (n: Names) => void,
    label: string,
  ) => React.ReactNode;
  onChange: (fields: FieldDef[]) => void;
}) {
  const t = useTranslations('categories');
  const tAll = useTranslations();
  const locale = useLocale();
  const fields = category.fields;
  const set = (key: string, change: (f: FieldDef) => FieldDef) =>
    onChange(fields.map((f) => (f.key === key ? change(f) : f)));
  const kindName = (key: string) => {
    const k = category.kinds.find((x) => x.key === key);
    return pickName(k?.names, locale, tAll.has(`kind.${key}`) ? tAll(`kind.${key}`) : key);
  };
  const standardOff = STANDARD_FIELDS.filter((s) => !fields.some((f) => f.key === s));

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('fields')}
      </h3>
      {fields.map((f, i) => {
        const used = usage.fields[`${category.key}/${f.key}`] ?? 0;
        const label = f.standard ? tAll(`fields.${f.key}`) : pickName(f.names, locale, f.key);
        return (
          <div key={f.key} className="space-y-2 rounded-md bg-muted/40 p-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {label} · {f.standard ? t('standard') : t(`type.${f.type ?? 'text'}`)}
                {!f.standard && ` · ${t('items', { count: used })}`}
              </span>
              <span className="flex items-center">
                <button
                  type="button"
                  className="rounded p-1 hover:bg-accent disabled:opacity-30"
                  aria-label={t('up')}
                  disabled={i === 0}
                  onClick={() => onChange(move(fields, i, -1))}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 hover:bg-accent disabled:opacity-30"
                  aria-label={t('down')}
                  disabled={i === fields.length - 1}
                  onClick={() => onChange(move(fields, i, 1))}
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 hover:bg-accent"
                  aria-label={t('remove')}
                  onClick={() => onChange(fields.filter((x) => x.key !== f.key))}
                >
                  <X className="size-4" />
                </button>
              </span>
            </div>
            {!f.standard && (
              <>
                {namesInput(
                  f.names,
                  (names) => set(f.key, (x) => ({ ...x, names })),
                  t('fieldName'),
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <NativeSelect
                    aria-label={t('fieldType')}
                    value={f.type ?? 'text'}
                    onChange={(e) =>
                      set(f.key, (x) => ({
                        ...x,
                        type: e.target.value as FieldType,
                        choices: e.target.value === 'choice' ? (x.choices ?? []) : undefined,
                      }))
                    }
                    className="h-9 w-40"
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`type.${type}`)}
                      </option>
                    ))}
                  </NativeSelect>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={(e) => set(f.key, (x) => ({ ...x, required: e.target.checked }))}
                      className="size-4"
                    />
                    {t('required')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!f.hidden}
                      onChange={(e) => set(f.key, (x) => ({ ...x, hidden: !e.target.checked }))}
                      className="size-4"
                    />
                    {t('shown')}
                  </label>
                </div>
                {f.type === 'choice' && (
                  <div className="space-y-2 border-l-2 pl-3">
                    {(f.choices ?? []).map((c) => (
                      <div key={c.key} className="flex items-start gap-2">
                        <div className="flex-1">
                          {namesInput(
                            c.names,
                            (names) =>
                              set(f.key, (x) => ({
                                ...x,
                                choices: x.choices?.map((y) =>
                                  y.key === c.key ? { ...y, names } : y,
                                ),
                              })),
                            t('choiceName'),
                          )}
                        </div>
                        <button
                          type="button"
                          className="mt-2 rounded p-1 hover:bg-accent"
                          aria-label={t('remove')}
                          onClick={() =>
                            set(f.key, (x) => ({
                              ...x,
                              choices: x.choices?.filter((y) => y.key !== c.key),
                            }))
                          }
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        set(f.key, (x) => ({
                          ...x,
                          choices: [
                            ...(x.choices ?? []),
                            {
                              key: keyFrom(
                                '',
                                (x.choices ?? []).map((y) => y.key),
                                `choice${(x.choices?.length ?? 0) + 1}`,
                              ),
                              names: {},
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="size-4" />
                      {t('addChoice')}
                    </Button>
                  </div>
                )}
              </>
            )}
            {category.kinds.length > 1 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">{t('forKinds')}</span>
                {category.kinds.map((k) => {
                  const on = !f.kinds?.length || f.kinds.includes(k.key);
                  return (
                    <label key={k.key} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          set(f.key, (x) => {
                            const current = x.kinds?.length
                              ? x.kinds
                              : category.kinds.map((y) => y.key);
                            const next = e.target.checked
                              ? [...current, k.key]
                              : current.filter((y) => y !== k.key);
                            return {
                              ...x,
                              kinds: next.length === category.kinds.length ? undefined : next,
                            };
                          })
                        }
                        className="size-3.5"
                      />
                      {kindName(k.key)}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...fields,
              {
                key: keyFrom(
                  '',
                  [...fields.map((f) => f.key), ...STANDARD_FIELDS.map((s) => s.toLowerCase())],
                  `field${fields.length + 1}`,
                ),
                names: {},
                type: 'text',
              },
            ])
          }
        >
          <Plus className="size-4" />
          {t('addField')}
        </Button>
        {standardOff.length > 0 && (
          <NativeSelect
            aria-label={t('addStandard')}
            value=""
            onChange={(e) =>
              e.target.value && onChange([...fields, { key: e.target.value, standard: true }])
            }
            className="h-8 w-auto"
          >
            <option value="">{t('addStandard')}</option>
            {standardOff.map((s) => (
              <option key={s} value={s}>
                {tAll(`fields.${s}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
    </div>
  );
}
