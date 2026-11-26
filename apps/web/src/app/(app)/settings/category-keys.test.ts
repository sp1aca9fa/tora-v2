import { type CategoryDef, type ConditionList, type Taxonomy, resolveTaxonomy } from '@tora/core';
import { describe, expect, it } from 'vitest';
import {
  newCategoryKey,
  newChoiceKey,
  newFieldKey,
  newKindKey,
  newListKey,
  newRegionKey,
  newValueKey,
  withNamedKeys,
} from './category-keys';

const watch: ConditionList = {
  key: 'watch_condition',
  names: { en: 'Watch condition' },
  values: [
    { key: 'unworn', names: { en: 'Unworn' } },
    { key: 'value2', names: { ja: '美品' } },
  ],
};
const watches: CategoryDef = {
  key: 'watches',
  names: { en: 'Watches' },
  kinds: [
    { key: 'watch', names: { en: 'Watch' }, conditions: 'watch_condition' },
    { key: 'kind2', names: { ja: '部品' }, conditions: 'item_condition' },
  ],
  fields: [
    {
      key: 'field1',
      names: { ja: '素材' },
      type: 'choice',
      choices: [{ key: 'choice1', names: { ja: '金' } }],
    },
  ],
  regions: ['jp', 'region2'],
  regionNames: { region2: { ja: '欧州' } },
};
const category2: CategoryDef = { key: 'category2', names: { ja: '時計' }, kinds: [], fields: [] };
const saved: Taxonomy = resolveTaxonomy({ categories: [watches, category2], lists: [watch] });

const listOf = (t: Taxonomy, key: string) => t.lists.find((l) => l.key === key)!;
const categoryOf = (t: Taxonomy, key: string) => t.categories.find((c) => c.key === key)!;

describe('new keys never take a key saved before this edit (G46)', () => {
  it('a value: removing the last one and adding one with a non-Latin name gives a new key', () => {
    const removed = { ...watch, values: watch.values.slice(0, 1) };
    const key = newValueKey(saved, removed);
    expect(key).not.toBe('value2');
    const added = { ...removed, values: [...removed.values, { key, names: { ja: '並品' } }] };
    const draft = { ...saved, lists: saved.lists.map((l) => (l.key === watch.key ? added : l)) };
    const out = listOf(withNamedKeys(draft, saved), watch.key).values.map((v) => v.key);
    expect(out).toEqual(['unworn', key]);
  });

  it('a value in an empty saved list starts at value1', () => {
    const empty = { key: 'list9', values: [] };
    const withEmpty = { ...saved, lists: [...saved.lists, empty] };
    expect(newValueKey(withEmpty, empty)).toBe('value1');
  });

  it('a kind, a field, a choice and a region of a saved category', () => {
    const draft: CategoryDef = {
      ...watches,
      kinds: watches.kinds.slice(0, 1),
      fields: [{ ...watches.fields[0]!, choices: [] }],
      regions: ['jp'],
    };
    expect(newKindKey(watches, draft)).toBe('kind2_2');
    expect(newFieldKey(watches, { ...draft, fields: [] })).toBe('field1_2');
    expect(newChoiceKey(watches.fields[0], draft.fields[0]!)).toBe('choice1_2');
    expect(newRegionKey(watches, draft)).toBe('region2_2');
  });

  it('a removed region re-added through the button keeps no stored meaning', () => {
    const draftCat: CategoryDef = { ...watches, regions: ['jp'], regionNames: undefined };
    const rk = newRegionKey(watches, draftCat);
    const draft: Taxonomy = {
      ...saved,
      categories: [
        { ...draftCat, regions: ['jp', rk], regionNames: { [rk]: { ja: '北米' } } },
        category2,
      ],
    };
    const out = categoryOf(withNamedKeys(draft, saved), 'watches');
    expect(out.regions).toEqual(['jp', rk]);
    expect(out.regions).not.toContain('region2');
    expect(out.regionNames).toEqual({ [rk]: { ja: '北米' } });
  });

  it('a category: removing one and adding one with a non-Latin name gives a new key', () => {
    const draft: Taxonomy = { ...saved, categories: [watches] };
    const key = newCategoryKey(saved, draft);
    expect(key).not.toBe('category2');
    const next = { ...draft, categories: [watches, { ...category2, key, names: { ja: '鞄' } }] };
    expect(withNamedKeys(next, saved).categories.map((c) => c.key)).toEqual(['watches', key]);
  });

  it('a new category has no saved keys to avoid but its own draft', () => {
    const c: CategoryDef = { key: 'category3', kinds: [], fields: [] };
    expect(newKindKey(undefined, c)).toBe('kind1');
    expect(newRegionKey(undefined, c)).toBe('region1');
  });

  it('saved keys never change, whatever their names become', () => {
    const renamed: Taxonomy = {
      lists: saved.lists.map((l) =>
        l.key === watch.key
          ? {
              ...l,
              names: { en: 'Other' },
              values: l.values.map((v) => ({ ...v, names: { en: 'X' } })),
            }
          : l,
      ),
      categories: [
        {
          ...watches,
          names: { en: 'Clocks' },
          kinds: watches.kinds.map((k) => ({ ...k, names: { en: 'Y' } })),
          regionNames: { region2: { en: 'Europe' } },
        },
        { ...category2, names: { en: 'Bags' } },
      ],
    };
    expect(withNamedKeys(renamed, saved)).toEqual(renamed);
  });
});

describe('reserved list keys are taken (G47)', () => {
  it.each([
    ['Raw', 'raw_2'],
    ['Graded', 'graded_2'],
    ['Cond', 'cond_2'],
    ['Sealed', 'sealed_2'],
    ['Card grades', 'card_grades_2'],
  ])('a list named %s gets %s', (name, key) => {
    const list = { key: newListKey(saved, saved), names: { en: name }, values: [] };
    const out = withNamedKeys({ ...saved, lists: [...saved.lists, list] }, saved);
    expect(out.lists.at(-1)!.key).toBe(key);
  });

  it('a list with no Latin name gets a made-up key, never a reserved one', () => {
    const key = newListKey(saved, saved);
    expect(key).toBe('list2');
    const list = { key, names: { ja: '状態' }, values: [] };
    const out = withNamedKeys({ ...saved, lists: [...saved.lists, list] }, saved);
    expect(out.lists.at(-1)!.key).toBe('list2');
  });

  it('a removed list key is not given again', () => {
    const draft = { ...saved, lists: saved.lists.filter((l) => l.key !== watch.key) };
    const list = { key: newListKey(saved, draft), names: { en: 'Watch condition' }, values: [] };
    const out = withNamedKeys({ ...draft, lists: [...draft.lists, list] }, saved);
    expect(out.lists.at(-1)!.key).toBe('watch_condition_2');
  });
});
