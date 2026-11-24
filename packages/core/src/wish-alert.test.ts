import { describe, expect, it } from 'vitest';
import {
  type WishAlertState,
  type WishNightCopy,
  type WishNightInput,
  WISH_QUIET_NIGHTS,
  mergeDelivered,
  mergeWishMemory,
  parseWishState,
  restartWish,
  stepWish,
} from './wish-alert';

// Made-up copies: `a1` at market-a for 9,500 is copy('marketa', 'a1', 9500).
const copy = (
  source: string,
  ref: string,
  price: number,
  more: Partial<WishNightCopy> = {},
): WishNightCopy => ({
  slot: `${source}|${ref}`,
  source,
  title: `${ref} title`,
  url: null,
  seller: `${ref}-seller`,
  price,
  paid: { known: true, amount: price },
  tonight: true,
  run: false,
  own: false,
  ...more,
});
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
const night = (
  n: number,
  copies: WishNightCopy[],
  more: Partial<WishNightInput> = {},
): WishNightInput => ({
  night: day(n),
  read: ['marketa', 'marketb', 'shopa'],
  price: 10_000,
  copies,
  checkNeeded: false,
  // The shop stored only the entries listed (a test names others it stored in another condition).
  shopSeen: [],
  ...more,
});

/** Runs the nights in order, each twice; returns what each first pass alerted (key or null). */
function run(nights: WishNightInput[], from: WishAlertState | null = null) {
  let state = from;
  const sent: (string | null)[] = [];
  for (const input of nights) {
    const first = stepWish(state, input);
    if (first) state = first.state;
    sent.push(first?.alert?.copy.key ?? null);
    // The closing step again on the same data: nothing sent, nothing changes.
    const again = stepWish(state, input);
    expect(again?.alert ?? null).toBeNull();
    if (again) expect(again.state).toEqual(state);
  }
  return { state: state!, sent };
}

describe('stepWish (S36 C3)', () => {
  it('alerts a first copy at or under the price, once', () => {
    const { state, sent } = run([
      night(1, [copy('marketa', 'a1', 9500), copy('marketa', 'a2', 9600)]),
      night(2, [copy('marketa', 'a1', 9500), copy('marketa', 'a2', 9600)]),
      night(3, [copy('marketa', 'a2', 9300)]),
    ]);
    expect(sent).toEqual(['marketa|a1', null, null]);
    expect(state).toMatchObject({ reads: 3, in: true, lastIn: 3, sent: 1 });
  });

  it('says nothing without a price, a read, or for an older night', () => {
    expect(stepWish(null, night(1, [copy('marketa', 'a1', 1)], { price: null }))).toBeNull();
    expect(stepWish(null, night(1, [copy('marketa', 'a1', 1)], { price: 0 }))).toBeNull();
    expect(stepWish(null, night(1, [copy('marketa', 'a1', 1)], { price: NaN }))).toBeNull();
    expect(stepWish(null, night(1, [copy('marketa', 'a1', 1)], { read: [] }))).toBeNull();
    const { state } = run([night(5, [])]);
    expect(stepWish(state, night(4, [copy('marketa', 'a1', 9000)]))).toBeNull();
  });

  it('blocks a copy alerted before unless its own price is 3 % lower', () => {
    const { sent } = run([
      night(1, [copy('marketa', 'a1', 10_000)]),
      night(2, []),
      night(20, [copy('marketa', 'a1', 9710)]),
      night(21, [copy('marketa', 'a1', 9700)]),
    ]);
    // Night 20 is read night 3: back in after the quiet ends? No, 3 - 1 < 14, and 9,710 is not 3 %
    // under the reference 10,000; the copy is also blocked (9,710 > 9,700).
    expect(sent).toEqual(['marketa|a1', null, null, 'marketa|a1']);
  });

  it('counts an unknown added cost on the stored price and says plus shipping', () => {
    const unknown = copy('marketa', 'a1', 9900, { paid: { known: false, amount: null } });
    const step = stepWish(null, night(1, [unknown, copy('marketb', 'b1', 10_100)]))!;
    expect(step.alert).toMatchObject({
      copy: { key: 'marketa|a1', cost: 9900 },
      plusShipping: true,
      only: true,
      nextUp: { key: 'marketb|b1', cost: 10_100 },
    });
    // As paid over the price: out, even though the stored price is under it.
    const over = copy('marketa', 'a2', 9800, { paid: { known: true, amount: 10_300 } });
    expect(stepWish(null, night(1, [over]))!).toMatchObject({ state: { in: false }, alert: null });
  });

  it('alerts on the same night when a kept copy is read on a second collect', () => {
    const kept = copy('marketa', 'a1', 9500, { tonight: false });
    const first = stepWish(null, night(1, [kept], { read: ['marketb'] }))!;
    expect(first).toMatchObject({ state: { in: true, reads: 1 }, alert: null });
    const second = stepWish(first.state, night(1, [copy('marketa', 'a1', 9500)]))!;
    expect(second.alert?.copy.key).toBe('marketa|a1');
    expect(second.state.reads).toBe(1);
  });

  it('does not turn in on kept copies: the night the copy is read alerts', () => {
    const out = Array.from({ length: 19 }, (_, i) => night(i + 2, []));
    const { state, sent } = run([
      night(1, [copy('marketa', 'old', 8000)]),
      ...out,
      // Market A refused: a1 is kept from an earlier read, market B read with nothing.
      night(21, [copy('marketa', 'a1', 9500, { tonight: false })], { read: ['marketb'] }),
      night(22, [copy('marketa', 'a1', 9500)]),
    ]);
    expect(sent).toEqual(['marketa|old', ...out.map(() => null), null, 'marketa|a1']);
    expect(state).toMatchObject({ reads: 22, in: true, lastIn: 22, sent: 22 });
    expect(state.keptIn).toBeUndefined();
    // Once in, kept copies hold it in: the next read night is no way back in.
    const held = run(
      [night(23, [copy('marketa', 'a1', 9500, { tonight: false })], { read: ['marketb'] })],
      state,
    );
    expect(held.state).toMatchObject({ in: true, lastIn: 23 });
    expect(held.state.keptIn).toBeUndefined();
  });

  it('is quiet when back within 14 read nights, and alerts on the 15th', () => {
    const out = (n: number) => night(n, []);
    const nights = (back: number) => [
      night(1, [copy('marketa', 'a1', 9500)]),
      ...Array.from({ length: back - 2 }, (_, i) => out(i + 2)),
      night(back, [copy('marketa', 'a2', 9400)]),
    ];
    expect(run(nights(WISH_QUIET_NIGHTS)).sent.at(-1)).toBeNull();
    expect(run(nights(WISH_QUIET_NIGHTS + 1)).sent.at(-1)).toBe('marketa|a2');
  });

  it('moves the reference when its copy is gone, to a fixed price, and keeps it on unread nights', () => {
    const { state, sent } = run([
      night(1, [copy('marketa', 'a1', 9000), copy('marketa', 'a2', 9500)]),
      night(2, [copy('marketa', 'a2', 9500)]),
      // Market A not read: its copies stay listed, the reference does not move.
      night(3, [copy('marketb', 'b1', 9800)], { read: ['marketb'] }),
    ]);
    expect(sent).toEqual(['marketa|a1', null, null]);
    expect(state.reference).toEqual({ cost: 9500, key: null, at: 2 });
    expect(stepWish(state, night(4, [copy('marketa', 'a3', 9200)]))!.alert?.copy.key).toBe(
      'marketa|a3',
    );
  });

  it('counts a check-needed night with nothing in and no alert', () => {
    const { state, sent } = run([
      night(1, [copy('marketa', 'a1', 9000)]),
      night(2, [copy('marketa', 'a2', 8000)], { checkNeeded: true }),
    ]);
    expect(sent).toEqual(['marketa|a1', null]);
    expect(state).toMatchObject({ reads: 2, in: false, lastIn: 1 });
    expect(state.reference).toEqual({ cost: 9000, key: 'marketa|a1', at: 1 });
  });

  it("keys the shop's entry by its in-stock run: a restock is a new copy", () => {
    const own = (n: number) =>
      night(n, [copy('shopa', 'S|own|used', 3800, { run: true, own: true })], { price: 4000 });
    // Out of stock for 14 read nights, then back at the same price: alerted again (plan 9.C).
    const out = Array.from({ length: 14 }, (_, i) => night(i + 2, [], { price: 4000 }));
    const { sent, state } = run([own(1), ...out, own(16)]);
    expect(sent).toEqual([
      `shopa|S|own|used|${day(1)}`,
      ...out.map(() => null),
      `shopa|S|own|used|${day(16)}`,
    ]);
    expect(state.runs).toEqual({ 'shopa|S|own|used': day(16) });
    expect(Object.keys(state.alerted)).toHaveLength(2);
    // An outside seller's entry at the same slot is another copy; the shop names no seller there.
    const outside = copy('shopa', 'S|out|used', 3700, { run: true, seller: null });
    expect(stepWish(null, night(1, [outside], { price: 4000 }))!.alert?.copy.key).toBe(
      `shopa|S|out|used|${day(1)}`,
    );
  });

  describe("an outside seller's shop entry with no seller named (the cheapest outside price)", () => {
    const slot = 'shopa|S|out|used';
    const outside = (n: number, price: number, wish = 4000) =>
      night(n, [copy('shopa', 'S|out|used', price, { run: true, seller: null })], { price: wish });
    const keys = (prices: number[]) => run(prices.map((p, i) => outside(i + 1, p)));
    const d1 = `${slot}|${day(1)}`;

    it('is told again when the wish comes in 14 read nights or more after its last alert', () => {
      // 3,000 alerted, then 4,500 for 28 read nights (out), then another seller at 3,050.
      const { sent, state } = keys([3000, ...Array.from({ length: 28 }, () => 4500), 3050]);
      expect(sent[0]).toBe(d1);
      expect(sent.slice(1, 29).every((k) => k === null)).toBe(true);
      // Its run started anew on read night 15, 14 after the alert.
      expect(sent[29]).toBe(`${slot}|${day(15)}`);
      expect(state.runs).toEqual({ [slot]: day(15) });
      expect(state.told).toEqual({ [slot]: 30 });
    });

    it('a cheaper price is told when 3 % under the one alerted, not for less', () => {
      const { sent, state } = keys([3000, 2950, 2900]);
      expect(sent).toEqual([d1, null, d1]);
      expect(state.reference).toEqual({ cost: 2900, key: d1, at: 3 });
      expect(keys([3000, 2950, 2920]).sent).toEqual([d1, null, null]);
    });

    it('a price moving up and down, by a little or by more than 3 %, is not told again', () => {
      const small = keys([3000, 3010, 3000, 3010, 3000]);
      expect(small.sent).toEqual([d1, null, null, null, null]);
      expect(small.state.reference).toEqual({ cost: 3000, key: d1, at: 1 });
      expect(keys([3000, 3100, 3000, 3100, 3000, 3100, 3000]).sent.slice(1)).toEqual(
        Array.from({ length: 6 }, () => null),
      );
      // Back at a price already told, with a higher one in between: still the copy told.
      expect(keys([2980, 3500, 3500, 3500, 2980]).sent.slice(1)).toEqual([null, null, null, null]);
    });

    it('a save does not tell it again within 14 read nights, whatever its price did', () => {
      for (const prices of [
        [3000, 2990],
        [3000, 3010],
        [3000, 2900, 3000],
      ]) {
        const first = keys(prices);
        const last = prices.at(-1)!;
        const next = stepWish(restartWish(first.state), outside(prices.length + 1, last, 4200))!;
        expect(next.alert).toBeNull();
      }
      // 3 % under what was alerted does alert after the save.
      const first = keys([3000, 2990]);
      expect(stepWish(restartWish(first.state), outside(3, 2900, 4200))!.alert?.copy.key).toBe(d1);
    });

    it('a save 14 read nights after its alert tells the price listed then, once', () => {
      const first = keys(Array.from({ length: 14 }, () => 3000));
      expect(first.sent.filter((k) => k !== null)).toEqual([d1]);
      const next = stepWish(restartWish(first.state), outside(15, 3000, 4200))!;
      expect(next.alert?.copy.key).toBe(`${slot}|${day(15)}`);
      expect(stepWish(next.state, outside(16, 3000, 4200))!.alert).toBeNull();
    });

    it('keeps its run through nights the shop stores no such entry, for 14 read nights', () => {
      const market = copy('marketa', 'a1', 3500);
      const used = copy('shopa', 'S|out|used', 3000, { run: true, seller: null });
      const fresh = copy('shopa', 'S|out|new', 2990, { run: true, seller: null });
      const on = (n: number, copies: WishNightCopy[]) =>
        night(n, copies, { price: 4000, read: ['shopa', 'marketa'] });
      // Told at 3,000; the next night the shop stores no outside entry; then it is back: not again.
      const gap = run([on(1, [used, market]), on(2, [market]), on(3, [used, market])]);
      expect(gap.sent).toEqual([d1, null, null]);
      expect(gap.state.runs[slot]).toBe(day(1));
      // The cheapest outside offer is a new copy for a night (another slot), then the used one is
      // back; a price saved after that does not tell it again.
      const swap = run([on(1, [used]), on(2, [fresh]), on(3, [used])]);
      expect(swap.sent).toEqual([d1, null, null]);
      expect(stepWish(restartWish(swap.state), on(4, [used]))!.alert).toBeNull();
      // Not stored for 14 read nights: the run is over, and what comes then is a new copy.
      const away = Array.from({ length: 14 }, (_, i) => on(i + 2, []));
      const back = run([on(1, [used]), ...away, on(16, [used])]);
      expect(back.sent.at(-1)).toBe(`${slot}|${day(16)}`);
    });

    it('counts the nights also while the entry is not among the copies (marked, another condition)', () => {
      // Alerted on night 1; not in the pool on nights 2 to 16 (the wish is out); back on night 17.
      const away = Array.from({ length: 15 }, (_, i) =>
        night(i + 2, [], { price: 4000, read: ['shopa'], shopSeen: [slot] }),
      );
      const { sent } = run([outside(1, 3000), ...away, outside(17, 3000)]);
      expect(sent.at(-1)).toBe(`${slot}|${day(17)}`);
    });
  });

  it("a delivered alert merged into a saved state keeps the shop entry's run it started", () => {
    const own = copy('shopa', 'S|own|used', 3800, { run: true, own: true });
    const stepped = stepWish(null, night(3, [own], { price: 4000 }))!;
    // The person's save won the write: its state has no run for the slot.
    const merged = mergeDelivered(null, stepped.alert!, stepped.state);
    expect(merged.runs).toEqual({ 'shopa|S|own|used': day(3) });
    // The next night the same copy at the same price is the one alerted: nothing.
    expect(stepWish(merged, night(4, [own], { price: 4000 }))!.alert).toBeNull();
    // Without the step's run the next night would start another and alert it again.
    const bare = mergeDelivered(null, stepped.alert!);
    expect(stepWish(bare, night(4, [own], { price: 4000 }))!.alert).not.toBeNull();
  });

  it("a delivered alert merged into a saved state takes the step's newer run and its night", () => {
    const outside = (n: number, wish: number) =>
      night(n, [copy('shopa', 'S|out|used', 3000, { run: true, seller: null })], { price: wish });
    // Told on night 1; 14 read nights on the person saves a price: night 15 tells it in a new run.
    const before = restartWish(
      run(Array.from({ length: 14 }, (_, i) => outside(i + 1, 4000))).state,
    );
    const stepped = stepWish(before, outside(15, 4100))!;
    expect(stepped.alert?.copy.key).toBe(`shopa|S|out|used|${day(15)}`);
    // A second save won the write: its state still holds the old run.
    const merged = mergeDelivered(restartWish(before), stepped.alert!, stepped.state);
    expect(merged.runs).toEqual({ 'shopa|S|out|used': day(15) });
    expect(merged.told).toEqual({ 'shopa|S|out|used': 15 });
    expect(stepWish(merged, outside(16, 4200))!.alert).toBeNull();
  });

  it("keeps a shop entry's run while its source stores it in any condition, marked or not", () => {
    const slot = 'shopa|S|own|good';
    const own = copy('shopa', 'S|own|good', 3800, { run: true, own: true });
    const stored = (n: number, copies: WishNightCopy[]) =>
      night(n, copies, { price: 4000, shopSeen: [slot] });
    // Wished fair: alerted; saved "like new" (the good copy leaves the pool); saved fair again.
    let state = run([stored(1, [own])]).state;
    const first = Object.keys(state.alerted);
    state = run([stored(2, [])], restartWish(state)).state;
    expect(state.runs).toEqual({ [slot]: day(1) });
    const back = run([stored(3, [own])], restartWish(state));
    expect(back.sent).toEqual([null]);
    expect(Object.keys(back.state.alerted)).toEqual(first);
    // Marked "not the item" on night 2, the mark taken back on night 3: the same copy.
    expect(run([stored(1, [own]), stored(2, []), stored(3, [own])]).sent).toEqual([
      `${slot}|${day(1)}`,
      null,
      null,
    ]);
    // Not stored on a night the shop was read: out of stock, so back is a restock (a new run).
    const restock = run([stored(1, [own]), night(2, [], { price: 4000 }), stored(3, [own])]);
    expect(restock.state.runs).toEqual({ [slot]: day(3) });
  });

  it('lists up to three sellers once each and never claims an unknown one is different', () => {
    const step = stepWish(
      null,
      night(1, [
        copy('marketa', 'a1', 9000, { seller: 's1' }),
        copy('marketa', 'a2', 9100, { seller: 's1' }),
        copy('marketa', 'a3', 9200, { seller: 's2' }),
        copy('marketb', 'b1', 9300, { seller: 's1' }),
      ]),
    )!;
    expect(step.alert!.sellers.map((c) => c.key)).toEqual([
      'marketa|a1',
      'marketa|a3',
      'marketb|b1',
    ]);
    expect(step.alert!.distinct).toBe(true);
    expect(step.alert!.only).toBe(false);
    const unknown = stepWish(
      null,
      night(1, [copy('marketa', 'a1', 9000, { seller: null }), copy('marketa', 'a2', 9100)]),
    )!;
    expect(unknown.alert!.distinct).toBe(false);
    expect(unknown.alert!.sellers).toHaveLength(2);
  });
});

describe('restartWish, mergeDelivered, parseWishState', () => {
  it('starts over on a saved price and keeps what was alerted', () => {
    const { state } = run([night(1, [copy('marketa', 'a1', 9000)])]);
    const restarted = restartWish(state);
    expect(restarted).toMatchObject({ in: false, lastIn: null, sent: null, reference: null });
    expect(restarted.alerted).toEqual({ 'marketa|a1': 9000 });
    const step = stepWish(restarted, {
      ...night(2, [copy('marketa', 'a1', 9000), copy('marketa', 'a2', 9400)]),
      price: 9500,
    })!;
    expect(step.alert?.copy.key).toBe('marketa|a2');
  });

  it('remembers a delivered copy over a newer state', () => {
    const alert = stepWish(null, night(1, [copy('marketa', 'a1', 9000)]))!.alert!;
    expect(mergeDelivered(null, alert).alerted).toEqual({ 'marketa|a1': 9000 });
    const { state } = run([night(1, [copy('marketb', 'b1', 9100)])]);
    const merged = mergeDelivered(restartWish(state), alert);
    expect(merged.alerted).toEqual({ 'marketb|b1': 9100, 'marketa|a1': 9000 });
    expect(merged.reference).toBeNull();
  });

  it("merges a dropped wish's memory of what was sent into the kept one", () => {
    const shop = (n: number, price: number) =>
      night(n, [copy('shopa', 'S1', price, { run: true, own: true })], { price: 4000 });
    // The kept wish alerted b1 at 9,000 and tracks S1 (over its price) from night 3; the dropped
    // one alerted S1 on its run from night 1, and a1, and b1 at 8,800.
    const kept = run([night(2, [copy('marketb', 'b1', 9000)]), shop(3, 4500)]).state;
    expect(kept.alerted).toEqual({ 'marketb|b1': 9000 });
    const dropped = run([shop(1, 3800)]).state;
    dropped.alerted = { ...dropped.alerted, 'marketa|a1': 9500, 'marketb|b1': 8800 };
    const merged = mergeWishMemory(kept, dropped);
    expect(merged.alerted).toEqual({
      'marketb|b1': 8800,
      [`shopa|S1|${day(1)}`]: 3800,
      'marketa|a1': 9500,
    });
    // The run a sent copy is keyed by; the rest of the kept state as it was.
    expect(merged.runs).toEqual({ 'shopa|S1': day(1) });
    expect({ ...merged, alerted: kept.alerted, runs: kept.runs }).toEqual(kept);
    // None kept: a fresh one.
    expect(mergeWishMemory(null, dropped)).toMatchObject({
      night: null,
      reads: 0,
      reference: null,
      alerted: dropped.alerted,
      runs: dropped.runs,
    });
  });

  it('reads a stored state back, or says it is not one', () => {
    const { state } = run([night(1, [copy('marketa', 'a1', 9000)])]);
    expect(parseWishState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(parseWishState(undefined)).toBeNull();
    expect(parseWishState(null)).toBeNull();
    for (const bad of [
      'x',
      [],
      { ...state, reads: -1 },
      { ...state, alerted: { k: 'x' } },
      { ...state, reference: { cost: 0, key: null, at: 1 } },
      { ...state, was: null },
      { ...state, runs: { s: 3 } },
    ])
      expect(parseWishState(bad)).toBe('invalid');
  });
});
