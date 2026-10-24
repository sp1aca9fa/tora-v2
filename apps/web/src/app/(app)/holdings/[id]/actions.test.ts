// Two tabs editing the same lot (S15): the second save, made from the older copy, is refused.
import { type Db, createHolding, createUser, getDb, getHoldingDetail, getUserById } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { beforeAll, expect, it, vi } from 'vitest';
import type { Session } from '@/lib/auth/guard';

const env = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/tora-lot-`);
  process.env.DATABASE_URL = `file:${dir}/test.db`;
  process.env.AUTH_SECRET = 'a'.repeat(32);
  return { session: null as Session | null };
});

vi.mock('@/lib/auth/guard', async () => {
  const { redirect } = await import('next/navigation');
  return { authed: async () => env.session ?? redirect('/login') };
});
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const { editAction } = await import('./actions');

let db: Db;
let userId: string;

beforeAll(async () => {
  db = getDb();
  await migrateDb(db);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  env.session = { db, user: (await getUserById(db, userId))!, device: { id: 'd' } } as never;
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

it('refuses a save from a lot changed elsewhere after the form was opened', async () => {
  const { holding } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'Card', cardNumber: '1' } },
    { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-10-01T12:00:00.000+09:00' },
  );
  const opened = holding.updatedAt;
  const fields = {
    acquiredAt: '2026-10-01',
    originalDate: '2026-10-01',
    acquisitionType: 'purchase',
    quantity: '1',
    costTotalBase: '1000',
  };
  await new Promise((r) => setTimeout(r, 5));
  // The first tab saves (and is sent back to the lot), the second tab's older copy is refused.
  await expect(
    editAction(holding.id, {}, form({ ...fields, costTotalBase: '1200', version: opened })),
  ).rejects.toThrow(/NEXT_REDIRECT/);
  expect(
    await editAction(holding.id, {}, form({ ...fields, quantity: '3', version: opened })),
  ).toEqual({ error: 'changedElsewhere' });
  const lot = (await getHoldingDetail(db, userId, holding.id))!.holding;
  expect([lot.quantity, lot.costTotalBase]).toEqual([1, 1200]);
  // Reloaded, the form carries the new version and saves.
  await expect(
    editAction(holding.id, {}, form({ ...fields, quantity: '3', version: lot.updatedAt })),
  ).rejects.toThrow(/NEXT_REDIRECT/);
});
