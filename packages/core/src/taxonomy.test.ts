import { describe, expect, it } from 'vitest';
import {
  catalogProductName,
  holdingFieldsFor,
  kindsForSetType,
  productClass,
  productFieldsFor,
} from './taxonomy';

describe('productClass', () => {
  it('classifies by category and kind', () => {
    expect(productClass({ category: 'tcg', kind: 'single' })).toBe('card');
    expect(productClass({ category: 'tcg', kind: 'booster_box' })).toBe('sealed');
    expect(productClass({ category: 'tcg', kind: 'deck' })).toBe('sealed');
    expect(productClass({ category: 'tcg', kind: 'supply' })).toBe('item');
    expect(productClass({ category: 'game', kind: 'amiibo' })).toBe('item');
  });

  it('maps classes to condition dimensions', () => {
    expect(holdingFieldsFor('card')).toEqual({ condition: false, packaging: false, grading: true });
    expect(holdingFieldsFor('sealed')).toEqual({
      condition: false,
      packaging: true,
      grading: false,
    });
    expect(holdingFieldsFor('item')).toEqual({ condition: true, packaging: true, grading: false });
  });

  it('shows platform only for games and card fields only for singles', () => {
    expect(productFieldsFor('game', 'software')).toContain('platform');
    expect(productFieldsFor('tcg', 'single')).toContain('cardNumber');
    expect(productFieldsFor('tcg', 'booster_box')).not.toContain('cardNumber');
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
