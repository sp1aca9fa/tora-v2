// Saving what a person looks for (S32): signed in only, cleaned, and only their own.
import { type Db, createProduct, createUser, getDb, getUserById } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { beforeAll, expect, it, vi } from 'vitest';
import type { Session } from '@/lib/auth/guard';

const env = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/tora-potential-`);
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

const { savePotentialAction } = await import('./actions');
const { cleanFilter } = await import('../opportunities/cards');

let db: Db;
let a: string;
let b: string;
const prefs = async (id: string) => (await getUserById(db, id))!.preferences?.potential;

beforeAll(async () => {
  db = getDb();
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  a = (await createUser(db, 'a', creds, 'admin')).user.id;
  b = (await createUser(db, 'b', creds)).user.id;
  await createProduct(db, a, {
    category: 'tcg',
    kind: 'single',
    name: 'Card',
    cardNumber: '1',
    rarity: 'XR',
  });
});

it('rejects a signed-out caller and saves nothing', async () => {
  env.session = null;
  await expect(savePotentialAction({ subjects: ['Dragon'] })).rejects.toThrow(/NEXT_REDIRECT/);
  expect(await prefs(a)).toBeUndefined();
  expect(await prefs(b)).toBeUndefined();
});

it('saves the cleaned criteria for the person signed in, and only them', async () => {
  env.session = { db, user: (await getUserById(db, a))!, device: { id: 'd' } } as never;
  const kept = await savePotentialAction({
    subjects: [' Dragon ', 'dragon', 'x'.repeat(50)],
    rarities: ['XR', 'made up'],
    outOfPrint: true,
  });
  expect(kept).toEqual({
    subjects: ['Dragon', 'x'.repeat(40)],
    rarities: ['XR'],
    outOfPrint: true,
    ranked: false,
  });
  expect(await prefs(a)).toEqual(kept);
  expect(await prefs(b)).toBeUndefined();
});

it('keeps a known way in the filter and drops an unknown one', () => {
  expect(cleanFilter({ way: 'falling_hard' }).way).toBe('falling_hard');
  expect(cleanFilter({ way: 'nope' }).way).toBeNull();
  expect(cleanFilter({ way: ['falling_hard'] }).way).toBeNull();
  expect(cleanFilter({}).way).toBeNull();
});
