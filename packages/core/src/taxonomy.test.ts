import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_CATEGORIES,
  checkTaxonomy,
  fieldsFor,
  holdingFieldsFor,
  itemTypeOf,
  itemTypes,
  resolveTaxonomy,
} from './categories';
import { catalogProductName, kindsForSetType, productClass } from './taxonomy';

const builtIn = resolveTaxonomy(null);
const keys = (fields: { key: string }[]) => fields.map((f) => f.key);

describe('productClass', () => {
  it('classifies by category and kind', () => {
    expect(productClass({ category: 'tcg', kind: 'single' })).toBe('card');
    expect(productClass({ category: 'tcg', kind: 'booster_box' })).toBe('sealed');
    expect(productClass({ category: 'tcg', kind: 'deck' })).toBe('sealed');
    expect(productClass({ category: 'tcg', kind: 'supply' })).toBe('item');
    expect(productClass({ category: 'game', kind: 'amiibo' })).toBe('game');
    expect(productClass({ category: 'watch', kind: 'wrist', itemType: 'watch/dial' })).toBe(
      'watch/dial',
    );
  });

  it('gives the built-in templates the same item types', () => {
    for (const c of BUILT_IN_CATEGORIES) {
      for (const k of c.kinds) {
        expect(itemTypeOf(builtIn, c.key, k.key)).toBe(
          productClass({ category: c.key, kind: k.key }),
        );
      }
    }
    expect(itemTypes(builtIn).map((t) => t.key)).toEqual(['card', 'sealed', 'item', 'game']);
    expect(checkTaxonomy(builtIn)).toEqual([]);
  });

  it('maps classes to condition dimensions', () => {
    expect(holdingFieldsFor('card')).toMatchObject({ grading: true, packaging: false });
    expect(holdingFieldsFor('sealed')).toMatchObject({ packaging: true, condition: false });
    expect(holdingFieldsFor('item')).toMatchObject({ condition: true, packaging: true });
    expect(holdingFieldsFor('game')).toMatchObject({ condition: true, value: null });
    expect(holdingFieldsFor('watch/dial')).toEqual({
      condition: false,
      packaging: false,
      grading: false,
      value: 'dial',
    });
  });

  it('shows the same fields as before for the built-in kinds', () => {
    expect(keys(fieldsFor(builtIn, 'game', 'software'))).toEqual([
      'franchise',
      'platform',
      'releaseDate',
      'retailPriceBase',
    ]);
    expect(keys(fieldsFor(builtIn, 'tcg', 'single'))).toEqual([
      'franchise',
      'setName',
      'setCode',
      'cardNumber',
      'rarity',
    ]);
    expect(keys(fieldsFor(builtIn, 'tcg', 'booster_box'))).toEqual([
      'franchise',
      'setName',
      'setCode',
      'variant',
      'releaseDate',
      'retailPriceBase',
    ]);
    expect(keys(fieldsFor(builtIn, 'tcg', 'supply'))).toEqual([
      'franchise',
      'releaseDate',
      'retailPriceBase',
    ]);
  });

  it('flags broken categories', () => {
    expect(
      checkTaxonomy({
        categories: [{ key: 'watch', kinds: [{ key: 'wrist', conditions: 'dial' }], fields: [] }],
        lists: [{ key: 'raw', values: [] }],
      }),
    ).toEqual(expect.arrayContaining(['list_key', 'list_empty', 'kind_list']));
  });
});

describe('catalog products', () => {
  it('offers kinds by set type', () => {
    expect(kindsForSetType('expansion')).toEqual(['booster_box', 'booster_pack']);
    expect(kindsForSetType('deck')).toEqual(['deck']);
  });

  it('names sealed products in the set name language', () => {
    expect(catalogProductName('バトルパートナーズ', 'booster_box')).toBe('バトルパートナーズ BOX');
    expect(catalogProductName('バトルパートナーズ', 'booster_pack')).toBe(
      'バトルパートナーズ パック',
    );
    expect(catalogProductName('Bloomburrow', 'booster_box', 'Collector')).toBe(
      'Bloomburrow Collector Booster Box',
    );
    expect(catalogProductName('スタートデッキ 赤 モンキー・D・ルフィ', 'deck')).toBe(
      'スタートデッキ 赤 モンキー・D・ルフィ',
    );
  });
});
