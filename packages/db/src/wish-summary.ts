// The morning summary's "Wishes" part (requirements S36 C3 last bullet, C4 pointer; plan W16 1.7 and
// 9.L). Pure over the page's views (`wishViews` with `detail`): per wish, only what is new since it
// was last told. Each event has a key; a key is told once while its event stays true; a key whose
// event ended is forgotten on every run (delivered or not), so the same event is told again only
// after it ended; keys are remembered only when a summary carrying them was delivered (the caller).
import {
  WISH_BUYBACK_MOVE,
  WISH_LEVEL_MOVE,
  WISH_POINTER_SHARE,
  fillText,
  type LevelChange,
} from '@tora/core';
import type { WishView } from './wish-view';

/** Wish id -> the keys told and still true. */
export type WishTold = Record<string, string[]>;

const pct = (share: number) => `${share > 0 ? '+' : ''}${Math.round(share * 100)}%`;
const POINTER = Math.round(WISH_POINTER_SHARE * 100);
const dir = (c: LevelChange) => (c.share > 0 ? 'up' : 'down');

/** A move of at least `share` either way, tested on the change's own amounts (no float share). */
const moved = (c: LevelChange | null | undefined, share: number): c is LevelChange =>
  !!c && c.from.level > 0 && Math.abs(c.amount) * 100 >= Math.round(share * 100) * c.from.level;

/**
 * Each view's events now (key -> its summary text): a level move of 5 % or more over 4 weeks; a
 * buyback move of 10 % or more; the shop's out-of-stock and "no new copy" runs (5 nights); a fact
 * recorded since `since` (no recorder's name); check needed with its reason; and the pointer to the
 * saved-search helper when tonight's cheapest copy an alert may name is above the price by 10 % or
 * less and the page has a helper to point to (S36 C4; a wish with no price gets no pointer, the
 * spec's "Assumed").
 */
export function wishEvents(
  v: WishView,
  since: string,
  t: Record<string, string>,
  money: (minor: number) => string,
  label: (source: string) => string,
): Map<string, string> {
  const out = new Map<string, string>();
  const line = (key: string, text: string | undefined, params: Record<string, string | number>) =>
    out.set(key, fillText(text ?? key, params));
  if (v.state === 'check_needed' && v.checkWhy)
    line(`check:${v.checkWhy}`, t[`summaryWishCheck_${v.checkWhy}`], {});
  const lv = v.level?.change;
  if (moved(lv, WISH_LEVEL_MOVE))
    line(`level:${dir(lv)}`, t.summaryWishLevel, { pct: pct(lv.share), price: money(lv.to.level) });
  const buy = v.bounds?.buyback;
  if (buy && moved(buy.change, WISH_BUYBACK_MOVE))
    line(`buyback:${buy.source}:${dir(buy.change)}`, t.summaryWishBuyback, {
      source: label(buy.source),
      pct: pct(buy.change.share),
      price: money(buy.price),
    });
  for (const f of v.facts) {
    if (f.kind === 'shop_out')
      line(`shop_out:${f.source}:${f.since}`, t.summaryWishShopOut, {
        source: label(f.source),
        nights: f.nights,
      });
    if (f.kind === 'no_new_copy')
      line(`no_new_copy:${f.since}`, t.summaryWishNoNew, { nights: f.nights });
  }
  for (const f of v.recorded)
    if (f.recordedAt >= since)
      line(`fact:${f.id}`, t.summaryWishFact, {
        kind: t[`summaryWishFact_${f.kind}`] ?? f.kind,
        text: f.text ? `: ${f.text}` : '',
      });
  const price = v.watch.targetPriceBase ?? 0;
  const c = v.night !== null && v.state === 'confirmed' ? v.cheapest : null;
  // `price < cost <= price * 1.1`, in whole minor units; no price, no pointer. The pointer names the
  // page's helper, so a wish whose helper is empty (a boxed wish, no stored search) gets none.
  if (
    c &&
    price > 0 &&
    v.helper.length > 0 &&
    c.counted > price &&
    c.counted * 100 <= price * (100 + POINTER)
  )
    line('pointer', t.summaryWishPointer, {
      price: money(c.counted),
      source: label(c.source),
      target: money(price),
    });
  return out;
}

/**
 * Each wish with something new (`lines`), the memory pruned to the keys still true (`told`), and
 * the memory once delivered (`withNew`: every key now true).
 */
export function wishSummary(
  views: readonly WishView[],
  told: WishTold,
  events: (v: WishView) => Map<string, string>,
) {
  const lines: { view: WishView; texts: string[] }[] = [];
  const kept: WishTold = {};
  const withNew: WishTold = {};
  for (const v of views.filter((x) => x.state !== 'not_game')) {
    const now = events(v);
    const before = new Set(told[v.watch.id]);
    const still = [...now.keys()].filter((k) => before.has(k));
    if (still.length) kept[v.watch.id] = still;
    if (now.size) withNew[v.watch.id] = [...now.keys()];
    const texts = [...now].flatMap(([k, text]) => (before.has(k) ? [] : [text]));
    if (texts.length) lines.push({ view: v, texts });
  }
  return { lines, told: kept, withNew };
}
