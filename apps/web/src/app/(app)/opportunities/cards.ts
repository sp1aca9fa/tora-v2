import 'server-only';
import {
  type OpportunitySignal,
  type OpportunityTests,
  type SignalRuleInfo,
  isBuiltInSignal,
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
    // Built-in signals and plug-ins' keys alike; an unknown one just matches no item.
    signals: [
      ...new Set(
        asked.filter((k): k is string => typeof k === 'string' && /^[a-z0-9_]{1,40}$/.test(k)),
      ),
    ].slice(0, 10),
  };
}

/** Within 10 % of the target: close (blue); 30 % or more over it: too high (red). */
const CLOSE = 0.1;
const TOO_HIGH = 0.3;

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

/** A signal's name: a built-in one's text, a plug-in's own label (S27). */
export function signalLabel(t: T, key: OpportunitySignal, rules: readonly SignalRuleInfo[]) {
  return isBuiltInSignal(key)
    ? t(`opportunities.signal.${key}`)
    : (rules.find((r) => r.key === key)?.label ?? key);
}

/** A signal's row on the Signals page, to link to (S27). */
export const signalAnchor = (group: string, key: string) =>
  `s-${group}-${key}`.replace(/[\s|#:/?]+/g, '-');

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
function rowOf(
  t: T,
  money: (n: number) => string,
  o: OpportunityCard,
  rules: readonly SignalRuleInfo[],
): OpportunityRowData {
  const n = o.numbers;
  // What the item's line is: its set, its line, or (too few of either) similar items.
  const scope = t(
    `opportunities.scope.${n.line84?.line?.startsWith('set:') ? 'set' : n.line84?.line ? 'line' : 'group'}`,
  );
  const why = (key: OpportunitySignal) =>
    !isBuiltInSignal(key)
      ? (rules.find((r) => r.key === key)?.about ?? '')
      : t(`opportunities.why.${key}`, {
          line: n.line84 ? signed(n.line84.change) : '-',
          scope,
          Scope: scope.charAt(0).toUpperCase() + scope.slice(1),
          items: (key.endsWith('_age') ? n.age?.items : n.line84?.items) ?? 0,
          own: n.own84 !== null ? signed(n.own84) : '-',
          sales30: n.sales30,
          before: Math.round(n.salesBefore ?? 0),
          change: n.age ? signed(n.age.change) : '-',
          typical: n.age ? signed(n.age.typical) : '-',
          days: n.age?.days ?? 0,
          jump: n.jump14 != null ? signed(n.jump14) : '-',
        });
  const signals = [
    ...o.proven.map((key) => ({ key, style: 'proven' as const })),
    ...o.warnings.map((key) => ({ key, style: 'warning' as const })),
    ...o.picked.map((key) => ({ key, style: 'pick' as const })),
    ...o.unproven
      .filter((key) => !o.picked.includes(key))
      .map((key) => ({ key, style: 'unproven' as const })),
  ];
  // With a warning on, measured against the target lowered for it.
  const goal = o.wait ? o.wait.under : o.target;
  const over = o.now !== null && goal ? o.now / goal - 1 : null;
  const warning = o.wait && signalLabel(t, o.wait.key, rules);
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
      o.owned && t('opportunities.ownedAnother'),
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
    tone: o.wait
      ? over !== null && over <= 0
        ? 'at'
        : 'wait'
      : over === null
        ? 'mid'
        : over <= 0
          ? 'at'
          : over <= CLOSE
            ? 'close'
            : over >= TOO_HIGH
              ? 'over'
              : 'mid',
    wait:
      o.wait && warning
        ? {
            label:
              o.wait.under !== null
                ? t('opportunities.waitUnder', { price: money(o.wait.under) })
                : t('opportunities.wait'),
            why: t(
              o.wait.under !== null ? 'opportunities.waitWhy' : 'opportunities.waitWhyNoTarget',
              {
                signal: warning,
                change: signed(o.wait.change),
                price: o.wait.under !== null ? money(o.wait.under) : '-',
                target: o.target ? money(o.target) : '-',
              },
            ),
          }
        : null,
    good: o.verdict === 'good' && (!o.wait || (over !== null && over <= 0)),
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
      label: signalLabel(t, key, rules),
      why: why(key),
      href: `/opportunities/signals#${signalAnchor(o.group, key)}`,
      record:
        style === 'pick'
          ? `${t('opportunities.pickTag')}: ${recordText(t, o.tests, key)}`
          : style === 'unproven'
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
  return data && { ...data, rows: data.items.map((o) => rowOf(t, money, o, data.rules)) };
}
