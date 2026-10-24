// Every server action called by the wrong person (requirements S15): a member calls each action
// with every id of another person's data, and nothing of theirs may change or come back; a member
// changes nothing through admin actions; a signed-out caller changes nothing at all. Forms are
// learned: when a form comes back with fields to check, other values are tried for those fields.
import * as core from '@tora/core';
import {
  type Db,
  addNote,
  addWatch,
  createHolding,
  createUser,
  getDb,
  getUserById,
  insertObservations,
  linkSource,
  sellHolding,
  setManualPrice,
  splitOff,
  startImportRun,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { seedCollection } from '@tora/db/seed';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Session } from '@/lib/auth/guard';

const env = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/tora-access-`);
  process.env.DATABASE_URL = `file:${dir}/test.db`;
  process.env.AUTH_SECRET = 'a'.repeat(32);
  return { dir, file: `${dir}/test.db`, session: null as Session | null };
});

vi.mock('@/lib/auth/guard', async () => {
  const { notFound, redirect } = await import('next/navigation');
  return {
    currentSession: async () => env.session,
    authed: async () => env.session ?? redirect('/login'),
    adminOnly: async () => {
      const session = env.session ?? redirect('/login');
      if (session.user.role !== 'admin') notFound();
      return session;
    },
  };
});
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (f: unknown) => f,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

/** Sign-in and account setup run before there is a session; their own tests cover them. */
const PUBLIC = ['login/actions.ts', 'login/setup/actions.ts'];
/** Text only the first person's lots carry: never in what another person gets back. */
const SECRET = 'secret-of-a';

interface Action {
  name: string;
  file: string;
  admin: boolean;
  params: string[];
  run: (...args: unknown[]) => Promise<unknown>;
}

let db: Db;
let a: string;
let b: string;
let actions: Action[];
/** One id per row of the first person's data and everything else not the member's. */
let ids: string[];

/** The parameter list of `export async function name(...)`, split at its top-level commas. */
function paramsOf(source: string, name: string): string[] {
  let i =
    source.indexOf(`export async function ${name}(`) + `export async function ${name}(`.length;
  const params: string[] = [];
  let depth = 0;
  let current = '';
  for (; i < source.length; i++) {
    const ch = source[i]!;
    if (depth === 0 && ch === ')') break;
    if ('({[<'.includes(ch)) depth++;
    if (')}]>'.includes(ch) && !(ch === '>' && source[i - 1] === '=')) depth--;
    if (depth === 0 && ch === ',') {
      params.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

async function loadActions(): Promise<Action[]> {
  const app = __dirname;
  const files: string[] = [];
  (function walk(dir: string) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/actions\.ts$/.test(f) && !PUBLIC.includes(relative(app, p))) files.push(p);
    }
  })(app);
  const list: Action[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.startsWith("'use server'")) continue;
    const mod = (await import(file)) as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const body of source.split(/^export async function /m).slice(1)) {
      const name = body.match(/^\w+/)![0];
      list.push({
        name,
        file: relative(app, file),
        admin: /role [!=]== 'admin'|adminOnly\(|await admin\(/.test(body),
        params: paramsOf(source, name),
        run: mod[name]!,
      });
    }
  }
  return list;
}

/** Values tried for a form field, `<id>` standing for the id under test. */
function candidates(field: string): string[] {
  const key = field.toLowerCase();
  const enums = Object.entries(core)
    .filter(
      ([name, v]) =>
        Array.isArray(v) &&
        typeof v[0] === 'string' &&
        name.toLowerCase().replace(/_/g, '').startsWith(key.slice(0, 6)),
    )
    .flatMap(([, v]) => (v as string[]).slice(0, 2));
  return ['<id>', '1', '2026-10-01', 'on', 'x', '1000', 'https://example.com/x', ...enums];
}

/** A value of a named string type (`Condition` from CONDITIONS), when core lists its values. */
function typed(type: string): string | undefined {
  const key = type.toLowerCase();
  const list = Object.entries(core).find(
    ([name, v]) =>
      Array.isArray(v) &&
      typeof v[0] === 'string' &&
      name.toLowerCase().replace(/_/g, '').startsWith(key),
  );
  return (list?.[1] as string[] | undefined)?.[0];
}

function argsFor(params: string[], id: string, form: Record<string, string>): unknown[] {
  const data = new FormData();
  for (const [k, v] of Object.entries(form)) data.set(k, v === '<id>' ? id : v);
  const anything = new Proxy(
    {},
    { get: (_t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : id) },
  );
  return params.map((p) => {
    const [name = '', type = ''] = p.split(/:(.*)/s).map((s) => s.trim());
    if (/FormData/.test(type)) return data;
    if (/State/.test(type) || name.startsWith('_prev')) return {};
    if (/^boolean/.test(type)) return true;
    if (/^number/.test(type)) return 1;
    if (/\[\]$/.test(type)) return [id];
    if (/^[A-Z]\w*$/.test(type) && typed(type)) return typed(type);
    if (/^\{|^[A-Z]/.test(type) && !/^string/.test(type)) return anything;
    return id;
  });
}

type Rows = Map<string, { json: string; userId: unknown }>;

async function snapshot(): Promise<Rows> {
  const rows: Rows = new Map();
  const tables = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'",
  );
  for (const { name } of tables.rows) {
    const result = await db.$client.execute(`SELECT rowid AS _r, * FROM "${String(name)}"`);
    for (const r of result.rows) {
      // A person's own row in users counts as theirs.
      const userId = name === 'users' ? r.id : r.user_id;
      rows.set(`${String(name)}:${String(r._r)}`, { json: JSON.stringify(r), userId });
    }
  }
  return rows;
}

/** Ids of rows the first person owns (their user_id), which no one else may point at. */
async function privateIds(): Promise<Set<string>> {
  const found = new Set<string>([a]);
  for (const [, row] of await snapshot()) {
    if (row.userId !== a) continue;
    const id = (JSON.parse(row.json) as { id?: unknown }).id;
    if (typeof id === 'string') found.add(id);
  }
  return found;
}

const stamp = () => statSync(env.file).mtimeMs;

beforeAll(async () => {
  db = getDb();
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  // An admin, so the owner's control run reaches the admin actions too.
  a = (await createUser(db, 'owner', creds, 'admin')).user.id;
  b = (await createUser(db, 'member', creds)).user.id;
  await seedCollection(db, a);
  const at = '2026-10-01T12:00:00.000+09:00';
  const { holding, product } = await createHolding(
    db,
    a,
    { product: { category: 'game', kind: 'amiibo', name: 'Owner only amiibo', region: 'jp' } },
    {
      quantity: 5,
      costTotalBase: 5_000,
      acquiredAt: at,
      acquiredFrom: SECRET,
      notes: SECRET,
      condition: 'new_unused',
      packagingState: 'sealed_shrink',
    },
  );
  await addNote(db, a, holding.id, { text: SECRET, occurredAt: at });
  await splitOff(db, a, holding.id, 1, at);
  await sellHolding(db, a, holding.id, {
    quantity: 1,
    priceBase: 2_000,
    feesBase: 100,
    platform: SECRET,
    occurredAt: at,
  });
  await setManualPrice(db, a, product.id, 'new', 1_500, SECRET);
  await addWatch(db, a, { productId: product.id }, { targetPriceBase: 900, note: SECRET });
  await startImportRun(db, { userId: a, method: 'file', note: SECRET });
  const source = await linkSource(db, product.id, { source: 'mercari', externalId: 'm1' });
  await insertObservations(db, [
    {
      productId: product.id,
      source: source.source,
      observationType: 'sold',
      priceBase: 1_000,
      observedAt: at,
      fetchedAt: at,
      externalRef: 'r1',
    },
  ]);
  const ownIds = new Set<string>();
  for (const [, row] of await snapshot()) {
    const id = (JSON.parse(row.json) as { id?: unknown }).id;
    if (typeof id === 'string' && row.userId !== b) ownIds.add(id);
  }
  ids = [...ownIds];
  actions = await loadActions();
}, 60_000);

afterAll(async () => {
  db.$client.close();
  const { rm } = await import('node:fs/promises');
  await rm(env.dir, { recursive: true, force: true });
});

/**
 * Runs `action` with `id`, learning its form: up to a few rounds, each moving the fields the
 * form named to their next value. Returns what the last call gave back (or threw).
 */
async function call(action: Action, id: string): Promise<unknown[]> {
  const form: Record<string, string> = {};
  const index: Record<string, number> = {};
  const results: unknown[] = [];
  for (let round = 0; round < 12; round++) {
    let result: unknown;
    try {
      result = await action.run(...argsFor(action.params, id, form));
    } catch (e) {
      result = e;
    }
    results.push(result);
    const fields = (result as { error?: string; fields?: string[] } | undefined)?.fields;
    if ((result as { error?: string } | undefined)?.error !== 'check' || !fields?.length) break;
    let moved = false;
    for (const f of fields) {
      const values = candidates(f);
      index[f] = (index[f] ?? -1) + 1;
      if (index[f]! < values.length) {
        form[f] = values[index[f]!]!;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return results;
}

async function sessionOf(userId: string): Promise<Session> {
  const user = (await getUserById(db, userId))!;
  return { db, user, device: { id: 'no-device' } } as unknown as Session;
}

it('keeps every action away from another person’s data', { timeout: 600_000 }, async () => {
  const hidden = await privateIds();
  env.session = await sessionOf(b);
  const problems: string[] = [];
  let before = await snapshot();
  let time = stamp();
  for (const action of actions) {
    for (const id of ids) {
      const results = await call(action, id);
      const label = `${action.file} ${action.name}`;
      if (results.some((r) => r && !(r instanceof Error) && JSON.stringify(r).includes(SECRET))) {
        problems.push(`${label}: returned the other person's text`);
      }
      if (stamp() === time) continue;
      const after = await snapshot();
      for (const [key, row] of before) {
        const now = after.get(key);
        if (now?.json === row.json || row.userId === b) continue;
        problems.push(`${label}: ${now ? 'changed' : 'deleted'} ${key}`);
      }
      for (const [key, row] of after) {
        if (before.has(key)) continue;
        if (action.admin) problems.push(`${label}: a member's admin call added ${key}`);
        else if ([...hidden].some((h) => row.json.includes(`"${h}"`))) {
          problems.push(`${label}: added ${key} pointing at the other person's data`);
        }
      }
      before = after;
      time = stamp();
    }
  }
  expect([...new Set(problems)]).toEqual([]);
});

it('changes nothing for a signed-out caller', { timeout: 120_000 }, async () => {
  env.session = null;
  const before = await snapshot();
  const reached: string[] = [];
  for (const action of actions) {
    const results = await call(action, ids[0]!);
    // Sent to sign in, or input refused before anything is read (nothing, or only an error).
    const fine = (r: unknown) =>
      (r instanceof Error && /NEXT_REDIRECT/.test(r.message)) ||
      r === undefined ||
      (typeof r === 'object' &&
        r !== null &&
        Object.keys(r).every((k) => k === 'error' || k === 'fields'));
    if (!results.every(fine)) {
      reached.push(`${action.file} ${action.name}`);
    }
  }
  const after = await snapshot();
  expect([...after].filter(([k, r]) => before.get(k)?.json !== r.json).map(([k]) => k)).toEqual([]);
  expect(reached).toEqual([]);
});

// The checks above mean little if the calls never get through: the owner, calling the same way,
// changes data through most actions (the rest take inputs too specific to guess, and were read
// by hand in S15).
it('reaches the data when the owner calls the same actions', { timeout: 600_000 }, async () => {
  env.session = await sessionOf(a);
  const idle: string[] = [];
  // Deleting and merging last, so the other actions still find the data.
  const last = (x: Action) => (/delete|remove|merge|cancel|logout|revoke/i.test(x.name) ? 1 : 0);
  for (const action of [...actions].sort((x, y) => last(x) - last(y))) {
    const time = stamp();
    for (const id of ids) await call(action, id);
    if (stamp() === time) idle.push(`${action.file} ${action.name}`);
  }
  expect(actions.length - idle.length).toBeGreaterThanOrEqual(39);
});
