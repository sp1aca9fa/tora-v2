import { type SourceRegistry, localDate } from '@tora/core';
import { type Db, blockedOn, createDb, schema } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addRefused,
  leftAlone,
  offEverywhere,
  recordRefusedRead,
  refusedResult,
  refusedSites,
  runFailed,
} from './collect-plan';

const registry = (r: Partial<SourceRegistry>): SourceRegistry => ({
  sources: [
    { key: 'megastore', label: 'Megastore', market: 'jp' },
    {
      key: 'arcade',
      label: 'Arcade',
      market: 'jp',
      identity: ['game'],
      links: [{ pattern: 'x', url: 'y' }],
    },
  ],
  roles: {},
  markets: { primary: 'jp', secondary: null },
  ...r,
});

describe('sources left out of the collect', () => {
  it('leaves out a source off for every item type', () => {
    expect(
      offEverywhere(registry({ roles: { megastore: { card: 'off', game: 'off' } } }), 'megastore'),
    ).toBe(true);
    // No role at all is off too.
    expect(offEverywhere(registry({}), 'megastore')).toBe(true);
  });

  it('keeps a source used for any type, even only for comparison', () => {
    expect(
      offEverywhere(
        registry({ roles: { megastore: { card: 'off', game: 'comparison' } } }),
        'megastore',
      ),
    ).toBe(false);
    expect(
      offEverywhere(registry({ roles: { megastore: { sealed: 'supporting' } } }), 'megastore'),
    ).toBe(false);
  });

  it('keeps an identity source whose roles are all off', () => {
    expect(offEverywhere(registry({ roles: { arcade: { game: 'off' } } }), 'arcade')).toBe(false);
    // The admin chose no identity source for games in its market: then it is off.
    const none = registry({
      roles: { arcade: { game: 'off' } },
      markets: { primary: 'jp', secondary: null, identity: { jp: { game: null } } },
    });
    expect(offEverywhere(none, 'arcade')).toBe(true);
  });

  it('keeps a source the registry does not describe (unknown is not off)', () => {
    expect(offEverywhere(registry({}), 'myboard')).toBe(false);
  });
});

describe('a site refusing outside a collector', () => {
  const fine = { source: 'arcade', status: 'ok', requests: 3, observations: 1 };

  it('makes the run a failure, as a refused collector does', () => {
    expect(runFailed([fine])).toBe(false);
    expect(runFailed([])).toBe(false);
    expect(runFailed([{ ...fine, status: 'partial' }])).toBe(false);
    expect(runFailed([{ ...fine, status: 'blocked' }])).toBe(true);
    expect(runFailed([fine, refusedResult('megastore', 'rankings')])).toBe(true);
    expect(runFailed([fine, refusedResult('megastore', 'opening')])).toBe(true);
  });

  it('counts no requests and has a status with its own text', () => {
    expect(refusedResult('megastore', 'opening')).toEqual({
      source: 'megastore',
      status: 'blocked_opening',
      requests: 0,
      observations: 0,
    });
  });
});

describe('sites left alone after a refusal today (Refusals)', () => {
  const today = new Set(['shopa', 'shopb']);

  it('leaves every site refused today out of a full run', () => {
    const sets = leftAlone(today, {});
    expect([...sets.blocked].sort()).toEqual(['shopa', 'shopb']);
    expect([...sets.leave].sort()).toEqual(['shopa', 'shopb']);
  });

  it('tries a named source again, in its run and in the reads of every site', () => {
    const sets = leftAlone(today, { source: 'shopa' });
    expect(sets.blocked.size).toBe(0);
    // Exchange rates, purchase links and pictures leave the other refused site alone.
    expect([...sets.leave]).toEqual(['shopb']);
  });

  it('tries the collectors again for a named item, never the reads of every site', () => {
    const sets = leftAlone(today, { product: 'p1' });
    expect(sets.blocked.size).toBe(0);
    expect([...sets.leave].sort()).toEqual(['shopa', 'shopb']);
  });

  it('adds a refusal in the run to both', () => {
    const sets = leftAlone(new Set(), { source: 'shopc' });
    addRefused(sets, 'shopc');
    expect([...sets.blocked]).toEqual(['shopc']);
    expect([...sets.leave]).toEqual(['shopc']);
  });
});

describe('refusals read and recorded by the collect', () => {
  const setup = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tora-plan-'));
    const db: Db = createDb({ url: `file:${join(dir, 'test.db')}` });
    await migrateDb(db);
    const state = join(dir, 'state');
    mkdirSync(state);
    return { db, state, done: () => rm(dir, { recursive: true, force: true }) };
  };

  it('replays a daytime stamp the database lost before reading the day (restore)', async () => {
    const { db, state, done } = await setup();
    try {
      const now = new Date();
      // A daytime refusal kept in its stamp; the database (restored) does not have it.
      writeFileSync(join(state, 'market-refused-marketa'), `${now.toISOString()} marketa\n`);
      const log: string[] = [];
      const run = { timeZone: 'Asia/Tokyo', now, stateDir: state };
      expect([...(await refusedSites(db, run, (m) => log.push(m)))]).toEqual(['marketa']);
      expect(log.join('\n')).toContain('recorded now');
      // --refresh tries every site again.
      expect((await refusedSites(db, { ...run, refresh: true })).size).toBe(0);
      // An unreadable stamp is logged; its site counts as refused, the database's refusals too.
      writeFileSync(join(state, 'market-refused-broken'), 'not a stamp\n');
      const later: string[] = [];
      expect([...(await refusedSites(db, run, (m) => later.push(m)))].sort()).toEqual([
        'broken',
        'marketa',
      ]);
      expect(later.join('\n')).toContain('market-refused-broken not readable');
    } finally {
      await done();
    }
  });

  it('replays the stamps after an unreadable one (restore)', async () => {
    const { db, state, done } = await setup();
    try {
      const now = new Date();
      // Read in name order: the broken stamp comes before marketa's; the database has neither.
      writeFileSync(join(state, 'market-refused-broken'), 'not a stamp\n');
      writeFileSync(join(state, 'market-refused-marketa'), `${now.toISOString()} marketa\n`);
      const log: string[] = [];
      const run = { timeZone: 'Asia/Tokyo', now, stateDir: state };
      expect([...(await refusedSites(db, run, (m) => log.push(m)))].sort()).toEqual([
        'broken',
        'marketa',
      ]);
      expect(log.join('\n')).toContain('marketa: its refusal at');
      // marketa's refusal is in the database now; the broken stamp is kept, still counted.
      expect([...(await blockedOn(db, localDate(now, 'Asia/Tokyo')))]).toEqual(['marketa']);
      // Once the file is older than the wait, it no longer counts (logged so it can be removed).
      const old = new Date(now.getTime() - 73 * 3_600_000);
      utimesSync(join(state, 'market-refused-broken'), old, old);
      const later: string[] = [];
      expect([...(await refusedSites(db, run, (m) => later.push(m)))]).toEqual(['marketa']);
      expect(later.join('\n')).toContain('older than its wait, not counted');
    } finally {
      await done();
    }
  });

  it("records a read's refusal as a blocked run on the day it came", async () => {
    const { db, done } = await setup();
    try {
      // Refused at 23:58 (app time) while reading pictures; recorded after midnight.
      const at = new Date('2026-11-01T23:58:00+09:00');
      expect(await recordRefusedRead(db, 'shopa', 'pictures', at)).toEqual(
        refusedResult('shopa', 'pictures'),
      );
      const [row] = await db.select().from(schema.collectorRuns);
      expect(row).toMatchObject({ source: 'shopa', status: 'blocked', requests: 0 });
      expect(row?.error).toContain('pictures');
      expect(Date.parse(row!.refusedAt!)).toBe(at.getTime());
      expect([...(await blockedOn(db, '2026-11-01'))]).toEqual(['shopa']);
      // A read with no refusal time: now.
      await recordRefusedRead(db, 'shopb', 'rates');
      const runs = await db.select().from(schema.collectorRuns);
      expect(runs.find((r) => r.source === 'shopb')?.refusedAt).toBeTruthy();
    } finally {
      await done();
    }
  });
});
