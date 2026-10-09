import { totpCode } from '@tora/auth';
import { count, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCatalogFiles, syncCatalog } from './catalog';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { listInventory } from './queries';
import { holdings, priceObservations, products, tcgSets } from './schema';
import { DEMO_TOTP_SECRET, seedCollection, seedDemoUser } from './seed';
import {
  MAX_ACTIVE_DEVICES,
  createUser,
  listDevices,
  markTotpStepUsed,
  registerDevice,
  revokeDevice,
  updateCredentials,
} from './users';

let db: Db;
const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };

beforeEach(async () => {
  // A temp file rather than :memory:, since libSQL transactions open a separate connection.
  const dir = await mkdtemp(join(tmpdir(), 'tora-db-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

describe('seed', () => {
  it('creates the demo account and scenario data, using the catalog', async () => {
    const entries = await loadCatalogFiles();
    expect(entries.length).toBeGreaterThan(1000);
    await syncCatalog(db, entries);
    await syncCatalog(db, entries); // idempotent
    const [sets] = await db.select({ n: count() }).from(tcgSets);
    expect(sets?.n).toBe(entries.length);

    const { user, backupCodes } = await seedDemoUser(db, 'a'.repeat(32));
    expect(backupCodes).toHaveLength(8);
    expect(totpCode(DEMO_TOTP_SECRET)).toMatch(/^\d{6}$/);
    await seedCollection(db, user.id);

    const rows = await listInventory(db, user.id, { status: 'all' });
    expect(rows.length).toBe(7);
    const boxRow = rows.find((r) => r.product.kind === 'booster_box');
    expect(boxRow?.product).toMatchObject({
      setCode: 'SV9',
      releaseDate: '2025-01-24',
      createdBy: null,
    });
    expect(boxRow?.holding.status).toBe('consumed');
    expect(rows.filter((r) => r.holding.parentHoldingId === boxRow?.holding.id)).toHaveLength(3);
  });
});

describe('accounts and devices', () => {
  it('first account is admin; limits active devices to 2; revoking frees a slot', async () => {
    const { user } = await createUser(db, 'alice', creds);
    expect(user.role).toBe('admin');
    expect((await createUser(db, 'bob', creds)).user.role).toBe('member');

    const first = await registerDevice(db, user.id, 'iPhone');
    const second = await registerDevice(db, user.id, 'PC');
    expect(first && second).toBeTruthy();
    expect(MAX_ACTIVE_DEVICES).toBe(2);
    expect(await registerDevice(db, user.id, 'third')).toBeNull();
    expect(await revokeDevice(db, user.id, first!.id)).toBe(true);
    expect(await revokeDevice(db, user.id, first!.id)).toBe(false);
    expect(await registerDevice(db, user.id, 'third')).not.toBeNull();

    await updateCredentials(db, user.id, { passwordHash: 'new' });
    expect(await listDevices(db, user.id)).toHaveLength(0);
  });

  it('accepts each TOTP step once', async () => {
    const { user } = await createUser(db, 'alice', creds);
    expect(await markTotpStepUsed(db, user.id, 100)).toBe(true);
    expect(await markTotpStepUsed(db, user.id, 100)).toBe(false);
    expect(await markTotpStepUsed(db, user.id, 99)).toBe(false);
    expect(await markTotpStepUsed(db, user.id, 101)).toBe(true);
  });
});

describe('constraints', () => {
  it('rejects invalid enum values, quantities and empty names', async () => {
    const { user } = await createUser(db, 'alice', creds);
    const [product] = await db
      .insert(products)
      .values({ category: 'game', kind: 'amiibo', name: 'Test' })
      .returning();
    const base = {
      userId: user.id,
      productId: product!.id,
      acquiredAt: '2026-10-09T00:00:00.000+09:00',
    };
    await expect(db.insert(holdings).values({ ...base, quantity: 0 })).rejects.toThrow();
    await expect(
      // @ts-expect-error invalid enum on purpose
      db.insert(holdings).values({ ...base, condition: 'mint' }),
    ).rejects.toThrow();
    await expect(
      db.insert(products).values({ category: 'game', kind: 'amiibo', name: ' ' }),
    ).rejects.toThrow();
    await expect(
      // @ts-expect-error invalid enum on purpose
      db.insert(products).values({ category: 'cards', kind: 'amiibo', name: 'x' }),
    ).rejects.toThrow();
  });

  it('dedupes observations by source + external_ref', async () => {
    const [product] = await db
      .insert(products)
      .values({ category: 'game', kind: 'amiibo', name: 'Test' })
      .returning();
    const obs = {
      productId: product!.id,
      source: 'mercari',
      observationType: 'sold' as const,
      priceJpy: 1000,
      observedAt: '2026-10-09T00:00:00.000+09:00',
      fetchedAt: '2026-10-09T00:00:00.000+09:00',
      externalRef: 'm123',
    };
    await db.insert(priceObservations).values(obs);
    await expect(db.insert(priceObservations).values(obs)).rejects.toThrow();
    await db.insert(priceObservations).values({ ...obs, source: 'snkrdunk' });
    const rows = await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.externalRef, 'm123'));
    expect(rows).toHaveLength(2);
  });
});
