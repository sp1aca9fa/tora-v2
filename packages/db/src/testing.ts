// Test fixtures shared by the packages' tests (not used by the app).
import type { SourceInfo } from '@tora/core';

/**
 * Sources as the Japan collectibles preset describes them, for tests whose data uses these keys.
 * The real descriptions live in the plug-ins.
 */
export const TEST_SOURCES: SourceInfo[] = [
  {
    key: 'snkrdunk',
    market: 'jp',
    label: 'SNKRDUNK',
    priority: 10,
    roles: { card: 'reference', sealed: 'reference' },
    identity: ['card', 'sealed'],
    links: [
      {
        pattern: 'snkrdunk\\.com/(?:en/)?apparels/(\\d+)',
        url: 'https://snkrdunk.com/apparels/{id}',
      },
    ],
    aliases: ['snkrdunk', 'スニダン', 'スニーカーダンク'],
    singleItemOrders: true,
  },
  {
    key: 'mercari',
    market: 'jp',
    label: 'Mercari',
    priority: 20,
    roles: { card: 'supporting', sealed: 'supporting', item: 'supporting' },
    aliases: ['mercari', 'メルカリ'],
    singleItemOrders: true,
  },
  {
    key: 'surugaya',
    market: 'jp',
    label: '駿河屋',
    priority: 30,
    roles: { sealed: 'supporting', item: 'reference' },
    identity: ['sealed', 'item'],
    links: [
      {
        pattern: 'suruga-ya\\.jp/product/(?:detail|other)/([A-Za-z0-9]+)',
        url: 'https://www.suruga-ya.jp/product/detail/{id}',
      },
    ],
    aliases: ['surugaya', '駿河屋'],
  },
  {
    key: 'tcgcsv',
    market: 'us',
    label: 'TCGplayer',
    priority: 40,
    roles: { card: 'comparison', sealed: 'comparison' },
  },
  {
    key: 'yahoo',
    label: 'Yahoo',
    shopOnly: true,
    aliases: ['yahoo', 'ヤフオク', 'paypay'],
    singleItemOrders: true,
  },
  { key: 'amazon', label: 'Amazon', shopOnly: true, aliases: ['amazon', 'アマゾン'] },
];
