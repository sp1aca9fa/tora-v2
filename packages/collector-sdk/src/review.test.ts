import { TEST_SOURCES } from '@tora/db/testing';
import {
  saveSourceInfos,
  type Db,
  createDb,
  createHolding,
  createQuerySource,
  createUser,
  decideSuggestion,
  insertObservations,
  listProductSources,
  openSuggestions,
  schema,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Judge, type ReviewAnswer, buildReviewCases, runReview } from './review';

let db: Db;
let user: { id: string; role: 'admin' | 'member' };
const now = new Date('2026-10-11T03:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-review-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  user = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user;
  return () => rm(dir, { recursive: true, force: true });
});

/** A box worth about 25,000 with three odd sales: two of a special edition, one too cheap. */
async function seed() {
  const { product } = await createHolding(
    db,
    user.id,
    { product: { category: 'tcg', kind: 'booster_box', name: '30th BOX', franchise: 'pokemon' } },
    {
      quantity: 1,
      costTotalBase: 20000,
      acquiredAt: ago(60),
      packagingState: 'sealed_shrink',
    },
  );
  await createQuerySource(db, product.id, 'mercari', { keywords: ['30th BOX'] });
  const sale = (ref: string, price: number, d: number, name: string) => ({
    productId: product.id,
    source: 'mercari',
    observationType: 'sold' as const,
    bucket: 'sealed:shrink',
    priceBase: price,
    currency: 'JPY',
    observedAt: ago(d),
    fetchedAt: ago(0),
    externalRef: ref,
    url: `https://item/${ref}`,
    raw: { name },
  });
  await insertObservations(db, [
    ...Array.from({ length: 9 }, (_, i) => sale(`n${i}`, 25000 + i * 100, 2 + i, '30th BOX')),
    sale('f1', 80000, 3, '30th FUTURISTIC BOX'),
    sale('f2', 82000, 4, '30th FUTURISTIC BOX 未開封'),
    sale('c1', 4000, 5, '30th BOX 空箱'),
  ]);
  return product;
}

/** A judge that answers from a script and records what it was asked. */
function scripted(answers: Partial<Record<'haiku' | 'sonnet', (ids: string[]) => ReviewAnswer>>) {
  const asked: { model: string; cases: string[] }[] = [];
  const judge: Judge = async (model, input) => {
    const ids = [...input.sales, ...input.searches].map((c) => c.case);
    asked.push({ model, cases: ids });
    return {
      answer: answers[model]?.(ids) ?? { verdicts: [], fixes: [] },
      costUsd: 0.01,
      tokens: 1000,
      modelName: `claude-${model}`,
    };
  };
  return { judge, asked };
}

it('files a word to skip for the special edition and an exclusion for the cheap sale', async () => {
  const product = await seed();
  const cases = await buildReviewCases(db, user.id, now);
  expect(cases.sales.map((c) => c.sale.title).sort()).toEqual([
    '30th BOX 空箱',
    '30th FUTURISTIC BOX',
    '30th FUTURISTIC BOX 未開封',
  ]);
  const caseOf = (title: string) => cases.sales.find((c) => c.sale.title === title)!.case;

  const { judge, asked } = scripted({
    haiku: (ids) => ({
      verdicts: ids.map((id) => ({
        case: id,
        verdict: id === caseOf('30th BOX 空箱') ? 'unsure' : 'exclude',
        confidence: id === caseOf('30th BOX 空箱') ? 0.4 : 0.9,
        reason: 'r',
      })),
      fixes: [
        {
          case: caseOf('30th FUTURISTIC BOX'),
          kind: 'exclude_word',
          word: 'FUTURISTIC',
          confidence: 0.9,
          reason: 'special edition',
        },
        // Its own name: never a word to skip.
        {
          case: caseOf('30th FUTURISTIC BOX'),
          kind: 'exclude_word',
          word: '30th',
          confidence: 0.9,
          reason: 'x',
        },
      ],
    }),
    sonnet: (ids) => ({
      verdicts: ids.map((id) => ({
        case: id,
        verdict: 'exclude',
        confidence: 0.85,
        reason: 'empty box',
      })),
      fixes: [],
    }),
  });
  const summary = await runReview(db, user.id, judge, { now });
  // Only the case Haiku was unsure about went to Sonnet.
  expect(asked).toEqual([
    { model: 'haiku', cases: expect.any(Array) },
    { model: 'sonnet', cases: [caseOf('30th BOX 空箱')] },
  ]);
  expect(summary.filed).toEqual({ exclude_word: 1, exclude_sale: 1 });
  expect(summary.costUsd).toBeCloseTo(0.02);

  const open = await openSuggestions(db, user.id);
  const word = open.find((o) => o.suggestion.kind === 'exclude_word')!.suggestion;
  expect(word.payload).toMatchObject({ word: 'FUTURISTIC' });
  // Every listing the word would drop, with its link.
  expect(word.evidence?.listings).toEqual([
    expect.objectContaining({ title: '30th FUTURISTIC BOX', kept: true }),
    expect.objectContaining({ title: '30th FUTURISTIC BOX 未開封', kept: true }),
  ]);
  const sale = open.find((o) => o.suggestion.kind === 'exclude_sale')!.suggestion;
  expect(sale.model).toBe('claude-sonnet');
  expect(sale.evidence).toMatchObject({ title: '30th BOX 空箱', url: 'https://item/c1' });

  // Accepting: the sale is excluded; the word is added and the search fetched again.
  await decideSuggestion(db, user, sale.id, true);
  const [obs] = await db
    .select()
    .from(schema.priceObservations)
    .where(eq(schema.priceObservations.id, String(sale.payload.observationId)));
  expect(obs).toMatchObject({ excluded: true, excludedReason: 'manual' });
  await decideSuggestion(db, user, word.id, true);
  const [search] = await listProductSources(db, product.id);
  expect(search!.query).toMatchObject({
    excludeKeywords: ['FUTURISTIC'],
    extra: { edited: true },
  });
  expect(await openSuggestions(db, user.id)).toHaveLength(0);

  // Nothing new to judge on the next run.
  const again = await runReview(db, user.id, judge, { now });
  expect(again.cases).toBe(0);
});

it('remembers sales judged fine and suggestions dismissed', async () => {
  await seed();
  const { judge } = scripted({
    haiku: (ids) => ({
      verdicts: ids.map((id, i) => ({
        case: id,
        verdict: i === 0 ? 'exclude' : 'keep',
        confidence: 0.9,
        reason: 'r',
      })),
      fixes: [],
    }),
  });
  const first = await runReview(db, user.id, judge, { now });
  expect(first.filed).toEqual({ exclude_sale: 1 });
  const [open] = await openSuggestions(db, user.id);
  await decideSuggestion(db, user, open!.suggestion.id, false, '  The real price, a rare sale.  ');
  const second = await runReview(db, user.id, judge, { now });
  expect(second.cases).toBe(0);
  // The note goes to the model on later reviews.
  expect((await buildReviewCases(db, user.id, now)).notes).toEqual([
    {
      product: '30th BOX',
      about: 'exclude_sale: r',
      decision: 'dismissed',
      note: 'The real price, a rare sale.',
    },
  ]);
});

it('fills product details on accept and fetches the search again', async () => {
  const product = await seed();
  const { judge } = scripted({
    haiku: (ids) => ({
      verdicts: ids.map((id) => ({ case: id, verdict: 'keep', confidence: 0.9, reason: 'r' })),
      fixes: [
        {
          case: ids[0]!,
          kind: 'fix_product',
          changes: { setName: '30th CELEBRATION', name: '30th BOX' },
          confidence: 0.8,
          reason: 'set in titles',
        },
      ],
    }),
  });
  await runReview(db, user.id, judge, { now });
  const [fix] = await openSuggestions(db, user.id);
  // Unchanged fields are left out.
  expect(fix!.suggestion.payload).toEqual({ changes: { setName: '30th CELEBRATION' } });
  await decideSuggestion(db, user, fix!.suggestion.id, true);
  const [after] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
  expect(after!.setName).toBe('30th CELEBRATION');
  expect(
    await db
      .select()
      .from(schema.priceObservations)
      .where(eq(schema.priceObservations.productId, product.id)),
  ).toHaveLength(0);
});
