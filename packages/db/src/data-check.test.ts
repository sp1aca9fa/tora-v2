// The self check's real path (plan-self-check.md points 8 and 10): packed sales on a test database,
// through the morning check to the message, with the texts the app really sends.
import {
  type DataCheckDescribed,
  type DataCheckState,
  type SourceInfo,
  dataCheckLine,
  fillText,
  localDate,
  toLocalIso,
} from '@tora/core';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordActivity } from './activity';
import { type AlertContext, addDiscordChannel, alertFailures, checkMissedRuns } from './alerts';
import { type Db, createDb } from './client';
import {
  DATA_CHECK_HREF,
  DATA_CHECK_KEY,
  type DataCheckView,
  dataCheckRows,
  dataCheckView,
  resetDataCheck,
  runDataCheck,
  watchDataCheck,
} from './data-check';
import { loadItemSales, refreshItemSales } from './item-sales';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import { readSetting, saveSetting, saveSourceInfos } from './registry';
import { VALUE_SERIES_BREAK_KEY } from './sales-recheck';
import { activity, collectorRuns } from './schema';
import { insertObservations } from './sources';
import { createUser } from './users';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const HOOK = 'https://discord.com/api/webhooks/123/abc-DEF_1';
const DAY = 86_400_000;

const SOURCES: SourceInfo[] = [
  { key: 'flea', label: 'Flea', market: 'jp', priceKinds: ['sold'] },
  { key: 'auction', label: 'Auction', market: 'jp', priceKinds: ['sold'] },
  { key: 'abroad', label: 'Abroad', market: 'us', priceKinds: ['sold'] },
  { key: 'noMarket', label: 'No market', priceKinds: ['sold'] },
  { key: 'shop', label: 'Shop', market: 'jp', priceKinds: ['listing'] },
  { key: 'hidden', label: 'Hidden', market: 'jp', priceKinds: ['sold'], noAi: true },
] as SourceInfo[];

// The texts people get, so a key the code names and the file lacks fails here.
const EN = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../apps/web/messages/en.json'), 'utf8'),
) as { alertText: Record<string, string> };

let db: Db;
let admin: string;
let sent: string[];

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (String(input).startsWith('https://discord.com/')) {
    if (!init?.method) return Response.json({ name: 'tora-alerts' });
    const body = JSON.parse(String(init.body)) as {
      content?: string;
      embeds?: { title?: string; description?: string; footer?: { text: string } }[];
    };
    sent.push(
      [
        body.content,
        ...(body.embeds ?? []).flatMap((e) => [e.title, e.description, e.footer?.text]),
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return new Response(null, { status: 204 });
  }
  return Response.json({ ok: false });
}) as typeof fetch;

const ctx: AlertContext = { secret: SECRET, texts: () => EN.alertText, fetch: fakeFetch };

const now = new Date();
const today = localDate(now);
const at = (daysAgo: number) => toLocalIso(new Date(now.getTime() - daysAgo * DAY));
const dayBack = (daysAgo: number) => localDate(new Date(now.getTime() - daysAgo * DAY));

let refs = 0;
async function addItem(name: string) {
  return (
    await createProduct(db, admin, {
      category: 'tcg',
      kind: 'single',
      name,
      cardNumber: String(++refs),
      franchise: 'pokemon',
    })
  ).id;
}

/** Sold rows of one item and condition. */
function sold(
  productId: string,
  source: string,
  price: number,
  count: number,
  options: {
    daysAgo?: number;
    excluded?: boolean;
    estimated?: boolean;
    bucket?: string | null;
    type?: 'sold' | 'listing';
  } = {},
) {
  return insertObservations(
    db,
    Array.from({ length: count }, () => ({
      productId,
      source,
      observationType: options.type ?? ('sold' as const),
      bucket: options.bucket === undefined ? 'raw:A' : options.bucket,
      priceBase: price,
      currency: 'JPY',
      observedAt: at(options.daysAgo ?? 1),
      fetchedAt: at(options.daysAgo ?? 1),
      externalRef: `r${++refs}`,
      excluded: options.excluded ?? false,
      excludedReason: options.excluded ? ('mismatch' as const) : null,
      quantityInferred: options.estimated ?? false,
      raw: {},
    })),
  );
}

const refresh = () => refreshItemSales(db, { full: true });

/** The state after this many nights, oldest first, ending yesterday. */
function learned(
  numbers: Record<string, { judged: number; far: number; kept: number; found: number }>,
  nights = 14,
  compared = 0,
): DataCheckState {
  const days: DataCheckState['days'] = {};
  for (let i = nights; i > 0; i--) days[dayBack(i)] = { sources: { ...numbers }, compared };
  return {
    days,
    open: {},
    resets: {},
    lastRun: nights ? dayBack(1) : null,
    firstSeen: null,
    itemsToldOn: null,
  };
}
const seed = (state: DataCheckState) => saveSetting(db, DATA_CHECK_KEY, state);
const saved = () => readSetting<DataCheckState>(db, DATA_CHECK_KEY);

/** 14 nights ending the day before yesterday, so yesterday can still be judged. */
function onTheEveOf(numbers: Parameters<typeof learned>[0]): DataCheckState {
  const state = learned(numbers, 15);
  delete state.days[dayBack(1)];
  return { ...state, lastRun: dayBack(2) };
}
/** A level that a week of a few sales falls far under. */
const quietFlea = { judged: 5, far: 0, kept: 700, found: 700 };

/** A collect (and a backup) that just ran, so the morning check judges and nothing is missed. */
async function collected() {
  await recordActivity(db, { kind: 'collect', occurredAt: toLocalIso(now) });
  await recordActivity(db, { kind: 'backup', occurredAt: toLocalIso(now) });
}

/** Runs that worked on each of the last 7 days. */
async function ranEveryDay(source: string, status: 'ok' | 'failed' | 'blocked' = 'ok') {
  await db.insert(collectorRuns).values(
    Array.from({ length: 7 }, (_, i) => ({
      source,
      status,
      startedAt: at(i),
      finishedAt: at(i),
    })),
  );
}

const checkEntries = (action: string) =>
  db
    .select()
    .from(activity)
    .then((rows) => rows.filter((r) => r.action === action));

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-data-check-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, SOURCES);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = (await createUser(db, 'admin', creds, 'admin')).user.id;
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  sent = [];
  return () => rm(dir, { recursive: true, force: true });
});

describe('the morning check', () => {
  it('reads the packed sales, says what it found once, and three calls make one message', async () => {
    const item = await addItem('A game');
    await sold(item, 'flea', 3000, 5);
    await sold(item, 'auction', 1000, 5);
    await refresh();
    await collected();
    await seed(learned({}));

    expect(await checkMissedRuns(db, ctx, now)).toEqual(['data_check']);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(EN.alertText.dataCheckTitle);
    expect(sent[0]).toContain('A game (A): Auction ¥1,000, Flea ¥3,000, 3x apart.');

    const entries = await checkEntries('data_check');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'check', level: 'problem', href: DATA_CHECK_HREF });

    const state = await saved();
    expect(state!.lastRun).toBe(today);
    expect(state!.days[today]!.compared).toBe(1);
    expect(Object.values(state!.open)).toMatchObject([{ kind: 'apart', told: true }]);

    for (const later of [60_000, 120_000]) {
      expect(await checkMissedRuns(db, ctx, new Date(now.getTime() + later))).toEqual([]);
    }
    expect(sent).toHaveLength(1);
    expect(await checkEntries('data_check')).toHaveLength(1);
  });

  it('counts a fine night once however many calls a morning makes', async () => {
    const item = await addItem('Back');
    await sold(item, 'flea', 3000, 5);
    await sold(item, 'auction', 1000, 5);
    await refresh();
    await collected();
    await seed(learned({}));
    await checkMissedRuns(db, ctx, now);

    // The next morning, as far as the check can tell: the same item, its prices together again.
    const state = (await saved())!;
    delete state.days[today];
    await seed(state);
    await sold(item, 'flea', 1000, 11);
    await refresh();
    for (const later of [0, 60_000, 120_000]) {
      await checkMissedRuns(db, ctx, new Date(now.getTime() + later));
    }
    expect(Object.values((await saved())!.open)).toMatchObject([{ kind: 'apart', fine: 1 }]);
  });

  it('saves its numbers and says nothing on a fine night, without counting rows of other days', async () => {
    const item = await addItem('Fine');
    await sold(item, 'flea', 1000, 10, { daysAgo: 20 });
    await sold(item, 'flea', 1000, 5, { daysAgo: 1 });
    await sold(item, 'flea', 1000, 3, { daysAgo: 8 });
    await sold(item, 'flea', 1000, 2, { daysAgo: 2, excluded: true });
    await refresh();
    await collected();
    await ranEveryDay('flea');
    expect(await checkMissedRuns(db, ctx, now)).toEqual([]);
    expect(sent).toEqual([]);
    expect(await checkEntries('data_check')).toEqual([]);
    expect((await saved())!.days[today]!.sources.flea).toEqual({
      judged: 5,
      far: 0,
      kept: 5,
      found: 7,
    });
  });

  it('with no collect for 5 days, judges nothing and makes no entries', async () => {
    await recordActivity(db, { kind: 'collect', occurredAt: at(5) });
    await recordActivity(db, { kind: 'backup', occurredAt: toLocalIso(now) });
    await seed(learned({ flea: { judged: 300, far: 3, kept: 300, found: 500 } }));
    const before = await saved();
    expect(await checkMissedRuns(db, ctx, now)).toEqual(['collect']);
    expect(await saved()).toEqual(before);
    // The missed collect says it, not this.
    expect(sent.join()).not.toContain(EN.alertText.dataCheckTitle);
  });

  it('never ran a collect at all: judges nothing and writes nothing', async () => {
    expect(await runDataCheck(db, now)).toBeNull();
    expect(await saved()).toBeNull();
  });

  it('a read that throws: `data_check_failed`, state unchanged, and the other steps still run', async () => {
    await recordActivity(db, { kind: 'collect', occurredAt: toLocalIso(now) });
    await recordActivity(db, { kind: 'backup', occurredAt: at(3) });
    const state = learned({});
    await seed(state);
    await db.$client.execute('drop table item_sales');

    expect(await checkMissedRuns(db, ctx, now)).toEqual(['data_check_failed', 'backup']);
    expect(await saved()).toEqual(state);
    const [failed] = await checkEntries('data_check_failed');
    expect(failed).toMatchObject({ kind: 'check', level: 'failed', href: DATA_CHECK_HREF });
    expect(sent.join('\n')).toContain("Tora's self check failed, so nothing is watching the data");
    expect(sent.join('\n')).toContain('Failed query');
  });

  it('packed rows empty: `kept` on every watched source, and `compared` 0 opens `blind`', async () => {
    const level = { judged: 300, far: 3, kept: 300, found: 500 };
    await collected();
    await ranEveryDay('flea');
    await ranEveryDay('auction');
    await seed(learned({ flea: level, auction: level }, 14, 30));

    expect(await checkMissedRuns(db, ctx, now)).toEqual(['data_check']);
    const state = await saved();
    expect(Object.keys(state!.open).toSorted()).toEqual([
      'blind:compared',
      'kept:auction',
      'kept:flea',
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(
      'Flea: 0 sales kept this week, down from about 300. It may be losing sales.',
    );
    expect(sent[0]).toContain(
      'Auction: 0 sales kept this week, down from about 300. It may be losing sales.',
    );
    expect(sent[0]).toContain('No item could be compared between sources (usually 30).');
  });

  it('failed and blocked runs do not count as runs: a fall they explain says nothing', async () => {
    const level = { judged: 300, far: 3, kept: 300, found: 500 };
    await collected();
    await ranEveryDay('flea', 'failed');
    await ranEveryDay('auction', 'blocked');
    await seed(learned({ flea: level, auction: level }));
    expect(await checkMissedRuns(db, ctx, now)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('the save failing after the record: the alert is kept, and the failure said too', async () => {
    const item = await addItem('A game');
    await sold(item, 'flea', 3000, 5);
    await sold(item, 'auction', 1000, 5);
    await refresh();
    await collected();
    const state = learned({});
    await seed(state);
    for (const event of ['insert', 'update']) {
      await db.$client.execute(
        `create trigger no_save_${event} before ${event} on app_settings
         when ${event === 'insert' ? 'new' : 'old'}.key = '${DATA_CHECK_KEY}'
         begin select raise(abort, 'refused'); end`,
      );
    }

    expect(await checkMissedRuns(db, ctx, now)).toEqual(['data_check_failed']);
    expect(await checkEntries('data_check')).toHaveLength(1);
    expect(await checkEntries('data_check_failed')).toHaveLength(1);
    expect(sent.join('\n')).toContain(EN.alertText.dataCheckTitle);
    expect(sent.join('\n')).toContain('A game (A)');
    expect(await saved()).toEqual(state);

    // Saved next time: said again rather than lost, on a day of its own.
    await db.$client.execute('drop trigger no_save_insert');
    await db.$client.execute('drop trigger no_save_update');
    expect(await runDataCheck(db, now)).toHaveLength(1);
    expect((await saved())!.lastRun).toBe(today);
  });

  it('caps a message at 10 lines, and says how many more', async () => {
    for (let i = 0; i < 12; i++) {
      const item = await addItem(`Item ${i}`);
      await sold(item, 'flea', 3000, 5);
      await sold(item, 'auction', 1000, 5);
    }
    await refresh();
    await collected();
    const none = { judged: 0, far: 0, kept: 0, found: 0 };
    await seed(learned({ flea: none, auction: none }));
    await checkMissedRuns(db, ctx, now);
    expect(sent).toHaveLength(1);
    // 12 items, and each source leaning on all 12: source lines first, so they are never the cut.
    expect(sent[0]).toContain('Flea reads high on 12 items');
    expect(sent[0]).toContain('Auction reads high on 0 items and low on 12');
    expect(sent[0]!.match(/3x apart/g)).toHaveLength(8);
    expect(sent[0]).toContain('And 4 more.');
  });

  it('11 waiting items and a new `kept` on a due day: the message has the source line', async () => {
    for (let i = 0; i < 11; i++) {
      const item = await addItem(`Item ${i}`);
      await sold(item, 'flea', 3000, 5);
      await sold(item, 'auction', 1000, 5);
    }
    await refresh();
    await collected();
    // The kept source is another market's, and the two compared have no nights of their own, so
    // `leans` stays out of the count of lines.
    await seed({ ...onTheEveOf({ abroad: quietFlea }), itemsToldOn: dayBack(3) });
    // Yesterday they open and wait for their group; no run counted yet, so nothing is said.
    expect(await checkMissedRuns(db, ctx, new Date(now.getTime() - DAY))).toEqual([]);
    expect(sent).toEqual([]);

    await ranEveryDay('abroad');
    await seed({ ...(await saved())!, itemsToldOn: dayBack(8) });
    expect(await checkMissedRuns(db, ctx, now)).toEqual(['data_check']);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(
      'Abroad: 0 sales kept this week, down from about 700. It may be losing sales.',
    );
    expect(sent[0]!.match(/3x apart/g)).toHaveLength(9);
    expect(sent[0]).toContain('And 2 more.');
  });

  it('a re-check day starts `far` over, whichever break is latest; an old one does not', async () => {
    const item = await addItem('A game');
    // A week with 4 % of its sales far: 2x a usual of 2 %, and under the ceiling.
    await sold(item, 'flea', 1000, 192, { daysAgo: 1 });
    await sold(item, 'flea', 5000, 8, { daysAgo: 1 });
    await refresh();
    await collected();
    await ranEveryDay('flea');
    const level = { judged: 200, far: 4, kept: 200, found: 200 };

    await seed(learned({ flea: level }));
    await saveSetting(db, VALUE_SERIES_BREAK_KEY, { a: dayBack(40), b: today, c: dayBack(90) });
    expect(await runDataCheck(db, now)).toEqual([]);

    await seed(learned({ flea: level }));
    await saveSetting(db, VALUE_SERIES_BREAK_KEY, { a: dayBack(40), c: dayBack(90) });
    expect(await runDataCheck(db, now)).toMatchObject([
      { kind: 'far', source: 'flea', share: 4, usual: 2, ceiling: false, label: 'Flea' },
    ]);
  });
});

describe('a finding reaches people, whenever the channels come back', () => {
  const down: AlertContext = {
    ...ctx,
    fetch: (async () => new Response(null, { status: 500 })) as typeof fetch,
  };
  const twoSources = async () => {
    const item = await addItem('A game');
    await sold(item, 'flea', 3000, 5);
    await sold(item, 'auction', 1000, 5);
    await refresh();
    await collected();
  };

  it('channels down on D, a retry the next night, a new finding that morning: both are delivered', async () => {
    await twoSources();
    await seed(onTheEveOf({ flea: quietFlea }));

    expect(await checkMissedRuns(db, down, new Date(now.getTime() - DAY))).toEqual(['data_check']);
    expect(sent).toEqual([]);
    expect((await checkEntries('data_check')).map((e) => e.occurredAt.slice(0, 10))).toEqual([
      dayBack(1),
    ]);

    // The after-run before the morning: yesterday's goes out.
    await alertFailures(db, ctx, at(2));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('A game (A)');

    // The morning: a new finding, whose cap is its own day's.
    await ranEveryDay('flea');
    expect(await checkMissedRuns(db, ctx, now)).toEqual(['data_check']);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain(
      'Flea: 5 sales kept this week, down from about 700. It may be losing sales.',
    );
    expect(sent[1]).not.toContain('A game');

    expect(await checkMissedRuns(db, ctx, new Date(now.getTime() + 60_000))).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  it('an older entry and a newer one going out together leave the cap on the newer day', async () => {
    await twoSources();
    await seed(onTheEveOf({ flea: quietFlea }));
    await checkMissedRuns(db, down, new Date(now.getTime() - DAY));
    await ranEveryDay('flea');
    await checkMissedRuns(db, down, now);
    await alertFailures(db, ctx, at(2));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('A game (A)');
    expect(sent[0]).toContain('Flea: 5 sales kept');
    expect(await readSetting(db, 'alertsSentToday')).toMatchObject({ 'check:data_check': today });
  });

  it('an older entry going out after a newer one: it is sent, and the cap stays on the newer day', async () => {
    await saveSetting(db, 'alertsSentToday', { 'check:data_check': today });
    await recordActivity(db, {
      kind: 'check',
      action: 'data_check',
      level: 'problem',
      detail: {
        findings: [{ kind: 'kept', source: 'flea', label: 'Flea', kept: 1, usual: 700 }],
      },
      href: DATA_CHECK_HREF,
      occurredAt: at(1),
    });
    await alertFailures(db, ctx, at(2));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Flea: 1 sales kept');
    expect(await readSetting(db, 'alertsSentToday')).toMatchObject({ 'check:data_check': today });
  });

  it('a save that keeps failing, three calls the same day: one message', async () => {
    await twoSources();
    await seed(learned({}));
    for (const event of ['insert', 'update']) {
      await db.$client.execute(
        `create trigger no_save_${event} before ${event} on app_settings
         when ${event === 'insert' ? 'new' : 'old'}.key = '${DATA_CHECK_KEY}'
         begin select raise(abort, 'refused'); end`,
      );
    }
    for (const later of [0, 60_000, 120_000]) {
      expect(await checkMissedRuns(db, ctx, new Date(now.getTime() + later))).toEqual([
        'data_check_failed',
      ]);
    }
    expect(await checkEntries('data_check')).toHaveLength(3);
    expect(sent.filter((m) => m.includes('A game (A)'))).toHaveLength(1);
  });

  it('a later step throwing: what was recorded still goes out, and the error still surfaces', async () => {
    await twoSources();
    await seed(learned({}));
    await db.$client.execute('drop table db_usage');
    await expect(checkMissedRuns(db, ctx, now)).rejects.toThrow(/db_usage/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('A game (A)');
  });
});

describe('the rows it reads', () => {
  it('kept sold rows of the sources asked about; found counts every stored row', async () => {
    const item = await addItem('A game');
    await sold(item, 'flea', 1000, 2);
    await sold(item, 'flea', 1000, 3, { excluded: true });
    await sold(item, 'flea', 1000, 1, { estimated: true });
    await sold(item, 'flea', 1000, 1, { bucket: null });
    await sold(item, 'flea', 1000, 1, { daysAgo: 70 });
    await sold(item, 'flea', 900, 1, { type: 'listing' });
    await sold(item, 'auction', 1000, 2);
    await refresh();

    const { sales, found } = dataCheckRows(await loadItemSales(db), new Set(['flea']), now);
    expect(new Set(sales.map((s) => s.source))).toEqual(new Set(['flea']));
    expect(Object.keys(found)).toEqual(['flea']);
    expect(sales).toHaveLength(4);
    expect(sales.filter((s) => s.estimated)).toHaveLength(1);
    expect(sales.filter((s) => s.bucket === null)).toHaveLength(1);
    expect(sales.every((s) => s.day === dayBack(1))).toBe(true);
    // Every stored row of the day (`packed.n`), the listing too: it is not split by type.
    expect(found.flea![dayBack(1)]).toBe(8);
    expect(found.flea![dayBack(70)]).toBeUndefined();
  });

  it('says nothing with nothing to read', () => {
    expect(dataCheckRows(new Map(), new Set(['flea']), now)).toEqual({ sales: [], found: {} });
  });
});

describe('`after-run`, when the check itself has stopped', () => {
  const collectOn = (daysAgo: number) =>
    recordActivity(db, { kind: 'collect', occurredAt: at(daysAgo) });

  it('`lastRun` unset: writes `firstSeen` once, and counts from it', async () => {
    expect(await watchDataCheck(db, now)).toBe(false);
    expect(await saved()).toMatchObject({ firstSeen: today, lastRun: null });
    expect(await watchDataCheck(db, new Date(now.getTime() + 2 * DAY))).toBe(false);
    expect((await saved())!.firstSeen).toBe(today);
  });

  it('1 day since `lastRun`: nothing', async () => {
    await seed(learned({}));
    await collectOn(0);
    expect(await watchDataCheck(db, now)).toBe(false);
    expect(await checkEntries('data_check_failed')).toEqual([]);
  });

  it('3 days of collects since `lastRun`: says so, once a day, and it goes out', async () => {
    const state = learned({});
    state.lastRun = dayBack(4);
    await seed(state);
    for (const d of [3, 2, 1]) await collectOn(d);

    expect(await watchDataCheck(db, now)).toBe(true);
    expect(await watchDataCheck(db, new Date(now.getTime() + 60_000))).toBe(false);
    const entries = await checkEntries('data_check_failed');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'failed',
      detail: { since: dayBack(4), days: 3 },
    });

    expect(await alertFailures(db, ctx, at(1))).toBe(1);
    expect(sent[0]).toContain(`has not run since ${dayBack(4)}`);
    expect(sent[0]).toContain('collects ran on 3 days');
  });

  it('a server off for days is not blamed: 2 days of collects, or none', async () => {
    const state = learned({});
    state.lastRun = dayBack(9);
    await seed(state);
    expect(await watchDataCheck(db, now)).toBe(false);
    await collectOn(1);
    await collectOn(0);
    expect(await watchDataCheck(db, now)).toBe(false);
  });
});

describe('what Settings and the data tool show', () => {
  const row = (view: DataCheckView, source: string) =>
    view.sources.find((s) => s.source === source);
  const steady = { judged: 300, far: 3, kept: 300, found: 500 };

  it('a row per sold source: watching, learning n of 14; never a noAi source', async () => {
    const state = learned({ flea: steady, auction: { judged: 7, far: 0, kept: 8, found: 8 } });
    delete state.days[dayBack(14)]!.sources.auction;
    state.days[dayBack(1)]!.sources.noMarket = steady;
    await seed(state);

    const view = await dataCheckView(db);
    expect(view.lastRun).toBe(dayBack(1));
    expect(view.sources).toHaveLength(4);
    expect(row(view, 'flea')).toEqual({ source: 'flea', label: 'Flea', status: 'watching' });
    expect(row(view, 'auction')).toMatchObject({ status: 'learning', nights: 13 });
    expect(row(view, 'abroad')).toMatchObject({ status: 'learning', nights: 0 });
    expect(row(view, 'noMarket')).toMatchObject({ status: 'learning', nights: 1 });
    expect(JSON.stringify(view)).not.toContain('hidden');
  });

  it('a source that stopped appearing: not seen since its last night', async () => {
    const state = learned({ flea: steady, auction: steady });
    delete state.days[dayBack(1)]!.sources.auction;
    await seed(state);
    const view = await dataCheckView(db);
    expect(row(view, 'auction')).toEqual({
      source: 'auction',
      label: 'Auction',
      status: 'notSeen',
      lastSeen: dayBack(8),
    });
    expect(row(view, 'flea')).toMatchObject({ status: 'watching' });
  });

  it('nothing yet: learning, no findings, never checked', async () => {
    const view = await dataCheckView(db);
    expect(view.lastRun).toBeNull();
    expect(view.open).toEqual([]);
    expect(row(view, 'flea')).toMatchObject({ status: 'learning', nights: 0 });
  });

  it('too few sales to judge, shown after the nights are in', async () => {
    await seed(learned({ flea: { judged: 7, far: 0, kept: 8, found: 8 } }));
    expect(row(await dataCheckView(db), 'flea')).toMatchObject({ status: 'tooFew' });
  });

  it('source findings first, then items by name', async () => {
    const item = await addItem('A game');
    await sold(item, 'flea', 3000, 5);
    await sold(item, 'auction', 1000, 5);
    await refresh();
    await collected();
    await ranEveryDay('flea');
    await seed(learned({ flea: { judged: 5, far: 0, kept: 700, found: 700 } }));
    await runDataCheck(db, now);
    const { open } = await dataCheckView(db);
    expect(open.map((o) => o.kind)).toEqual(['kept', 'apart']);
    expect(open[1]).toMatchObject({ name: 'A game', label: 'Auction', otherLabel: 'Flea' });
  });

  it('a reset starts a source over and closes its findings; a noAi or unknown source is refused', async () => {
    await collected();
    await ranEveryDay('flea');
    await seed(learned({ flea: steady }));
    await runDataCheck(db, now);
    expect((await saved())!.open['kept:flea']).toBeDefined();

    expect(await resetDataCheck(db, 'hidden', now)).toBe(false);
    expect(await resetDataCheck(db, 'nothing', now)).toBe(false);
    expect((await saved())!.open['kept:flea']).toBeDefined();

    expect(await resetDataCheck(db, 'flea', now)).toBe(true);
    const state = await saved();
    expect(state!.open).toEqual({});
    expect(state!.resets).toEqual({ flea: today });
    expect(row(await dataCheckView(db), 'flea')).toMatchObject({ status: 'learning', nights: 0 });
  });

  it('a source off the list with a finding open can be reset; a noAi one or a stranger cannot', async () => {
    const base = {
      openedOn: dayBack(1),
      lastSeenOn: dayBack(1),
      judgedOn: dayBack(1),
      fine: 0,
      told: true,
    };
    const state = learned({ flea: steady });
    state.open['kept:gone'] = {
      ...base,
      key: 'kept:gone',
      kind: 'kept',
      source: 'gone',
      kept: 1,
      usual: 9,
    };
    state.open['kept:hidden'] = {
      ...base,
      key: 'kept:hidden',
      kind: 'kept',
      source: 'hidden',
      kept: 1,
      usual: 9,
    };
    state.open['apart:p'] = {
      ...base,
      key: 'apart:p',
      kind: 'apart',
      source: 'flea',
      other: 'elsewhere',
      productId: 'p',
      bucket: 'raw:A',
      price: 1,
      otherPrice: 3,
      sales: 5,
      otherSales: 5,
    };
    await seed(state);

    expect(await resetDataCheck(db, 'hidden', now)).toBe(false);
    expect(await resetDataCheck(db, 'nothing', now)).toBe(false);
    expect(await saved()).toEqual(state);

    expect(await resetDataCheck(db, 'gone', now)).toBe(true);
    const after = await saved();
    expect(after!.open['kept:gone']).toBeUndefined();
    expect(after!.resets).toEqual({ gone: today });
    // Only named on an open item: that closes itself, so a reset has nothing to close.
    expect(await resetDataCheck(db, 'elsewhere', now)).toBe(false);
  });
});

describe('sources kept from AI', () => {
  it('their sold rows reach no number, state, entry or message', async () => {
    const item = await addItem('A game');
    await sold(item, 'flea', 1000, 5);
    await sold(item, 'hidden', 5000, 5);
    await refresh();
    await collected();
    await ranEveryDay('hidden');
    await seed(learned({ flea: { judged: 5, far: 0, kept: 5, found: 5 } }));

    expect(await checkMissedRuns(db, ctx, now)).toEqual([]);
    expect(JSON.stringify(await saved())).not.toContain('hidden');
    expect(sent).toEqual([]);
    expect(await checkEntries('data_check')).toEqual([]);
    expect((await saved())!.days[today]!.compared).toBe(0);
  });

  it('one marked after its numbers were stored: they go the next morning, and from the view now', async () => {
    const steady = { judged: 300, far: 3, kept: 300, found: 500 };
    const state = learned({ flea: steady, hidden: steady });
    state.open['kept:hidden'] = {
      key: 'kept:hidden',
      kind: 'kept',
      source: 'hidden',
      kept: 1,
      usual: 300,
      openedOn: dayBack(1),
      lastSeenOn: dayBack(1),
      judgedOn: dayBack(1),
      fine: 0,
      told: true,
    };
    await seed(state);
    const view = await dataCheckView(db);
    expect(JSON.stringify(view)).not.toContain('hidden');
    // Nothing shaped by it is left to show: every source starts over, and the last morning stays.
    expect(view.open).toEqual([]);
    expect(view.lastRun).toBe(dayBack(1));
    expect(view.sources.find((s) => s.source === 'flea')).toMatchObject({
      status: 'learning',
      nights: 0,
    });
    await collected();
    await runDataCheck(db, now);
    const after = await saved();
    expect(JSON.stringify(after)).not.toContain('hidden');
    expect(Object.keys(after!.days)).toEqual([today]);
  });
});

describe('the texts', () => {
  it('fills every line a finding can make, with nothing left over', () => {
    const base = { key: 'k', openedOn: 'a', lastSeenOn: 'a', judgedOn: 'a', fine: 0, told: true };
    const findings = [
      { kind: 'far', source: 'flea', share: 7, usual: 3, judged: 1, far: 1, ceiling: false },
      { kind: 'far', source: 'flea', share: 7, usual: 6, judged: 1, far: 1, ceiling: true },
      { kind: 'kept', source: 'flea', kept: '5', usual: '9' },
      { kind: 'rate', source: 'flea', rate: 0.3, usual: 0.6 },
      { kind: 'blind', source: 'flea', judged: 1, usual: 9 },
      { kind: 'blind', source: null, compared: 0, usual: 9 },
      { kind: 'leans', source: 'flea', high: 10, low: 2 },
      {
        kind: 'apart',
        source: 'flea',
        other: 'auction',
        otherLabel: 'Auction',
        productId: 'p',
        name: 'A game',
        bucket: 'raw:A',
        price: 1000,
        otherPrice: 3000,
        sales: 5,
        otherSales: 5,
      },
    ];
    for (const f of findings) {
      const line = dataCheckLine(
        { ...base, label: 'Flea', ...f } as DataCheckDescribed,
        (n) => `¥${n}`,
        (b) => b,
      );
      const text = EN.alertText[line.key];
      expect(text, line.key).toBeDefined();
      expect(fillText(text!, line.params), line.key).not.toMatch(/[{}]/);
    }
  });
});
