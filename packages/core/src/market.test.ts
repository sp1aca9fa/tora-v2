import { describe, expect, it } from 'vitest';
import { median, parseSourceUrl } from './market';

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('parseSourceUrl', () => {
  it('parses SNKRDUNK product links', () => {
    expect(parseSourceUrl('https://snkrdunk.com/apparels/484952?slide=right')).toEqual({
      source: 'snkrdunk',
      externalId: '484952',
      url: 'https://snkrdunk.com/apparels/484952',
    });
    expect(
      parseSourceUrl(' https://snkrdunk.com/apparels/484952/sales-histories ')?.externalId,
    ).toBe('484952');
    expect(parseSourceUrl('https://snkrdunk.com/en/apparels/12')?.externalId).toBe('12');
  });

  it('parses 駿河屋 and TCGplayer product links', () => {
    expect(parseSourceUrl('https://www.suruga-ya.jp/product/detail/109000490?tenpo_cd=1')).toEqual({
      source: 'surugaya',
      externalId: '109000490',
      url: 'https://www.suruga-ya.jp/product/detail/109000490',
    });
    expect(parseSourceUrl('https://www.suruga-ya.jp/product/other/GN764576')?.externalId).toBe(
      'GN764576',
    );
    expect(
      parseSourceUrl(
        'https://www.tcgplayer.com/product/587815/pokemon-japan-sv-p-promotional-cards-taipeis-pikachu-057-sv-p?Language=English',
      ),
    ).toEqual({
      source: 'tcgcsv',
      externalId: '587815',
      url: 'https://www.tcgplayer.com/product/587815/pokemon-japan-sv-p-promotional-cards-taipeis-pikachu-057-sv-p',
    });
  });

  it('rejects other links and text', () => {
    expect(parseSourceUrl('https://example.com/apparels/1')).toBeNull();
    expect(parseSourceUrl('snkrdunk 484952')).toBeNull();
    expect(parseSourceUrl('https://snkrdunk.com/search?keywords=x')).toBeNull();
  });
});
