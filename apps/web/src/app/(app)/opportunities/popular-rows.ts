import 'server-only';
import {
  type Db,
  type PopularBy,
  type RankingBoard,
  type User,
  dailySeries,
  pickSeries,
  imageVersions,
  loadPopularity,
  productsByIds,
  rankPopular,
  rankedViews,
  rankingBoards,
  sold30Of,
  trendOf,
} from '@tora/db';
import { localDate } from '@tora/core';
import { getTranslations } from 'next-intl/server';
import { getMoney } from '@/lib/money-server';
import { sourceLabels } from '@/lib/sources';
import { signalLabel } from './cards';

/** Rows the server sends at a time on Popular (S27). */
export const POPULAR_BATCH = 30;

/** A ranked item as texts (the list draws them on the client). */
export interface PopularRowData {
  key: string;
  rank: number;
  productId: string | null;
  href: string | null;
  product: { id: string; name: string; category: string; kind: string };
  version: string | null;
  /** Week move, listings, favorites; trades per site; owned, watching. */
  meta: string[];
  /** Tora's view: worth a look, wait or under a price, good price, or the target and how far. */
  tora: {
    text: string | null;
    tone: 'wait' | 'good' | 'mid';
    worth: boolean;
    signals: string[];
  } | null;
  /** The site's price (a ranking's), and Tora's. */
  price: string | null;
  toraPrice: string | null;
  /** The last 90 days' daily prices as an SVG polyline (100 x 24), and whether down overall. */
  spark: { points: string; down: boolean } | null;
}

const SPARK_DAYS = 90;

type Item = RankingBoard['items'][number];

/** Each item type's site rankings: a ranking goes to the type most of its items are. */
const typeOfBoard = (b: RankingBoard) => {
  const count = new Map<string, number>();
  for (const i of b.items) if (i.itemType) count.set(i.itemType, (count.get(i.itemType) ?? 0) + 1);
  return [...count].sort((a, z) => z[1] - a[1])[0]?.[0] ?? null;
};

/** Popular for an item type, ranked by a site's ranking or by trades (S27). */
export async function loadPopular(
  db: Db,
  user: Pick<User, 'id' | 'preferences'>,
  type: string | null,
  by: PopularBy,
  offset: number,
) {
  const [boards, saved, t, tAll, money, labelOf] = await Promise.all([
    rankingBoards(db, user.id),
    loadPopularity(db),
    getTranslations('opportunities'),
    getTranslations(),
    getMoney(),
    sourceLabels(),
  ]);
  const boardTypes = new Map(boards.map((b) => [b.ranking, typeOfBoard(b)]));
  const types = [
    ...new Set([
      ...[...boardTypes.values()].filter((x): x is string => !!x),
      ...(saved?.items ?? []).filter((i) => i.sold365 > 0).map((i) => i.itemType),
    ]),
  ];
  const chosen = type && types.includes(type) ? type : (types[0] ?? null);
  const typeBoards = boards.filter((b) => boardTypes.get(b.ranking) === chosen);
  // Site rankings when the type has one, else trades.
  const measure: PopularBy = by === 'site' && !typeBoards.length ? 'sold' : by;
  const ranked = saved && chosen && measure !== 'site' ? rankPopular(saved, chosen, measure) : [];
  const page = ranked.slice(offset, offset + POPULAR_BATCH);
  const ids = [
    ...(measure === 'site' ? typeBoards.flatMap((b) => b.items.map((i) => i.productId)) : []),
    ...page.map((i) => i.productId),
  ].filter((id): id is string => !!id);
  const since = localDate(new Date(Date.now() - SPARK_DAYS * 86_400_000));
  const [images, views, items, series] = await Promise.all([
    imageVersions(db, ids),
    rankedViews(db, user, ids),
    productsByIds(
      db,
      page.map((i) => i.productId),
    ),
    dailySeries(db, ids, since),
  ]);
  /** The item's studied prices (Tora's series) over 90 days, as a small line. */
  const spark = (productId: string | null): PopularRowData['spark'] => {
    const v = productId ? views.items.get(productId) : undefined;
    if (!v || !productId) return null;
    const s = pickSeries(series, productId, v.bucket || null, v.source)?.series ?? [];
    const points = s.filter((p) => p.day >= since);
    if (points.length < 5) return null;
    const prices = points.map((p) => p.price);
    const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
    const x = (i: number) => ((i / (points.length - 1)) * 100).toFixed(1);
    const y = (p: number) => (hi === lo ? 12 : 22 - ((p - lo) / (hi - lo)) * 20).toFixed(1);
    return {
      points: points.map((p, i) => `${x(i)},${y(p.price)}`).join(' '),
      down: prices.at(-1)! < prices[0]!,
    };
  };
  const byId = new Map(items.map((p) => [p.id, p]));

  const tora = (productId: string | null): PopularRowData['tora'] => {
    const v = productId ? views.items.get(productId) : undefined;
    if (!v) return null;
    const goal = v.wait ? v.wait.under : v.target;
    const over = v.now !== null && goal ? v.now / goal - 1 : null;
    const [text, tone]: [string | null, 'wait' | 'good' | 'mid'] =
      v.wait && (over === null || over > 0)
        ? [
            v.wait.under !== null ? t('waitUnder', { price: money(v.wait.under) }) : t('wait'),
            'wait',
          ]
        : v.verdict === 'good' || (over !== null && over <= 0)
          ? [t('goodNow'), 'good']
          : v.target && over !== null
            ? [
                `${t('target')} ${money(v.target)} · ${t('toGo', { pct: `${Math.round(over * 100)}%` })}`,
                'mid',
              ]
            : [null, 'mid'];
    return {
      text,
      tone,
      worth: v.worth,
      signals: [...v.proven, ...v.warnings].map((k) => signalLabel(tAll, k, views.rules)),
    };
  };
  const toraPrice = (productId: string | null) => {
    const v = productId ? views.items.get(productId) : undefined;
    return v?.now != null ? t('toraNow', { price: money(v.now) }) : null;
  };
  const href = (id: string) => `/products/${id}`;

  /** A site ranking's item. */
  const siteRow = (b: RankingBoard, i: Item): PopularRowData => ({
    key: `${b.ranking}|${i.rank}|${i.title}`,
    rank: i.rank,
    productId: i.productId,
    href: i.productId ? href(i.productId) : null,
    product: {
      id: i.productId ?? i.title,
      name: i.title,
      category: i.category ?? 'tcg',
      kind: i.kind ?? 'other',
    },
    version: i.productId ? (images.get(i.productId) ?? null) : null,
    meta: [
      `${t('colWeek')} ${
        i.weekAgo === null
          ? t('rankNew')
          : i.weekAgo === i.rank
            ? '='
            : `${i.weekAgo > i.rank ? '+' : '-'}${Math.abs(i.weekAgo - i.rank)}`
      }`,
      i.numbers?.listings !== undefined ? t('listingsN', { n: i.numbers.listings }) : null,
      i.numbers?.favorites !== undefined ? t('favoritesN', { n: i.numbers.favorites }) : null,
      i.owned ? t('owned') : null,
      i.watching ? t('watching') : null,
    ].filter((m): m is string => !!m),
    tora: tora(i.productId),
    price: i.price !== null ? money(i.price) : null,
    toraPrice: toraPrice(i.productId),
    spark: spark(i.productId),
  });

  const rows: PopularRowData[] = page.flatMap((i, n) => {
    const p = byId.get(i.productId);
    if (!p) return [];
    const sites = Object.entries(i.sold30)
      .sort((a, z) => z[1] - a[1])
      .map(([s, k]) => `${labelOf(s)} ${k}`)
      .join(' · ');
    return [
      {
        key: i.productId,
        rank: offset + n + 1,
        productId: i.productId,
        href: href(i.productId),
        product: { id: p.id, name: p.name, category: p.category, kind: p.kind },
        version: images.get(p.id) ?? null,
        meta: [
          measure === 'year'
            ? t('popular.tradesYear', { n: i.sold365 })
            : t('popular.trades30', { n: sold30Of(i) }),
          measure === 'trending'
            ? t('popular.trendX', { x: trendOf(i).toFixed(1), before: Math.round(i.before90 / 3) })
            : null,
          sites ? t('popular.bySite', { sites }) : null,
        ].filter((m): m is string => !!m),
        tora: tora(i.productId),
        price: null,
        toraPrice: toraPrice(i.productId),
        spark: spark(i.productId),
      },
    ];
  });

  return {
    types,
    type: chosen,
    by: measure,
    /** Site rankings asked, none for the type: most traded shown. */
    fellBack: by === 'site' && measure !== 'site',
    day: saved?.day ?? null,
    boards:
      measure === 'site'
        ? typeBoards.map((b) => ({
            ranking: b.ranking,
            label: b.label,
            day: b.day,
            rows: b.items.map((i) => siteRow(b, i)),
          }))
        : [],
    total: ranked.length,
    rows,
  };
}
