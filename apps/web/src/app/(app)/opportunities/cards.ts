import 'server-only';
import {
  type OpportunitySignal,
  type OpportunityTests,
  OPPORTUNITY_SIGNALS,
  PROVEN_MIN_CHECKS,
} from '@tora/core';
import { type Db, type OpportunityCard, type Product, type User, opportunityCards } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { getMoney } from '@/lib/money-server';
import { bucketLabel, franchiseLabel } from '@/lib/product-display';
import type { OpportunityRowData } from './opportunity-row';

/** Rows the server sends at a time, with the page and as the list is scrolled (S26). */
export const BATCH = 20;

export interface CardsFilter {
  type: string | null;
  /** Items with every one of these on (`?signal=a,b`). */
  signals: OpportunitySignal[];
}

/** A filter from the address or a client: unknown values dropped. */
export function cleanFilter(f: {
  type?: unknown;
  signal?: unknown;
  signals?: unknown;
}): CardsFilter {
  const asked = Array.isArray(f.signals)
    ? f.signals
    : typeof f.signal === 'string'
      ? f.signal.split(',')
      : [];
  return {
    type: typeof f.type === 'string' && f.type.length < 40 ? f.type : null,
    signals: OPPORTUNITY_SIGNALS.filter((k) => asked.includes(k)),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x > 0 ? '+' : ''}${pct(x)}`;

type T = Awaited<ReturnType<typeof getTranslations>>;

/** A group of similar items as people read it, from one of its items. */
export function groupLabel(t: T, p: Product) {
  return [
    t(`kind.${p.kind}`),
    franchiseLabel(p.franchise, t),
    p.region && t(`region.${p.region}`),
    p.platform,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** An item type's name ("Sealed"). */
export const typeLabel = (t: T, type: string) =>
  t.has(`sourceRoles.class.${type}`) ? t(`sourceRoles.class.${type}`) : type;

/** A signal's record on its group's past prices, as a sentence. */
export function recordText(t: T, tests: OpportunityTests | null, key: OpportunitySignal) {
  const r = tests?.signals[key];
  if (!tests || !r || r.checked < PROVEN_MIN_CHECKS) {
    return t('opportunities.recordFew', { checked: r?.checked ?? 0 });
  }
  return t('opportunities.record', {
    higher: r.higher,
    checked: r.checked,
    pct: pct(r.higher / r.checked),
    any: tests.any.checked ? pct(tests.any.higher / tests.any.checked) : '-',
  });
}

/** "#3 SNKRDUNK popular Pokemon boxes, up 2 in a week" for a ranked item. */
export function rankText(t: T, rank: number, weekAgo: number | null, label: string) {
  return t('opportunities.rankLine', {
    rank,
    label,
    move:
      weekAgo === null
        ? t('opportunities.rankNew')
        : weekAgo === rank
          ? t('opportunities.rankSame')
          : t(weekAgo > rank ? 'opportunities.rankUp' : 'opportunities.rankDown', {
              n: Math.abs(weekAgo - rank),
            }),
  });
}

/** A card as its row's texts (the list draws them on the client). */
function rowOf(t: T, money: (n: number) => string, o: OpportunityCard): OpportunityRowData {
  const n = o.numbers;
  const why = (key: OpportunitySignal) =>
    t(`opportunities.why.${key}`, {
      line: n.line84 ? signed(n.line84.change) : '-',
      items: (key.endsWith('_age') ? n.age?.items : n.line84?.items) ?? 0,
      own: n.own84 !== null ? signed(n.own84) : '-',
      sales30: n.sales30,
      before: Math.round(n.salesBefore ?? 0),
      change: n.age ? signed(n.age.change) : '-',
      typical: n.age ? signed(n.age.typical) : '-',
      days: n.age?.days ?? 0,
    });
  const signals = [
    ...o.proven.map((key) => ({ key, style: 'proven' as const })),
    ...o.warnings.map((key) => ({ key, style: 'warning' as const })),
    ...o.unproven.map((key) => ({ key, style: 'unproven' as const })),
  ];
  const over = o.now !== null && o.target ? o.now / o.target - 1 : null;
  return {
    productId: o.productId,
    href: `/products/${o.productId}/buy${o.bucket ? `?condition=${encodeURIComponent(o.bucket)}` : ''}`,
    product: {
      id: o.product.id,
      name: o.product.name,
      category: o.product.category,
      kind: o.product.kind,
    },
    version: o.imageVersion,
    meta: [
      o.bucket && bucketLabel(o.bucket, t),
      o.owned && t('opportunities.owned'),
      o.watching && t('opportunities.watching'),
      !o.product.createdBy && !o.owned && !o.watching && t('opportunities.candidate'),
    ].filter((m): m is string => Boolean(m)),
    ranks: o.ranks.map((r) => ({
      short: `#${r.rank}`,
      text: rankText(t, r.rank, r.weekAgo, r.label),
    })),
    now: o.now !== null ? money(o.now) : null,
    target: o.target ? money(o.target) : null,
    toGo:
      over === null
        ? null
        : over <= 0
          ? t('opportunities.atTarget')
          : t('opportunities.toGo', { pct: pct(over) }),
    reach: over === null ? null : Math.min(1, 1 / (1 + Math.max(0, over))),
    good: o.verdict === 'good',
    askUnder:
      o.askUnder && o.ask && n.price
        ? t('opportunities.askUnder', {
            amount: money(o.ask.price),
            pct: pct(1 - o.ask.price / n.price),
          })
        : null,
    buylistNear:
      o.buylistNear && o.buylist
        ? t('opportunities.buylistNear', { amount: money(o.buylist.price) })
        : null,
    signals: signals.map(({ key, style }) => ({
      key,
      style,
      label: t(`opportunities.signal.${key}`),
      why: why(key),
      record:
        style === 'unproven'
          ? `${t('opportunities.notProven')}: ${recordText(t, o.tests, key)}`
          : recordText(t, o.tests, key),
    })),
    watching: o.watching,
  };
}

/** A batch of the Worth a look list with its rows' texts. */
export async function loadCards(
  db: Db,
  user: Pick<User, 'id' | 'preferences'>,
  filter: CardsFilter,
  offset: number,
) {
  const [data, t, money] = await Promise.all([
    opportunityCards(db, user, filter, offset, BATCH),
    getTranslations(),
    getMoney(),
  ]);
  return data && { ...data, rows: data.items.map((o) => rowOf(t, money, o)) };
}
