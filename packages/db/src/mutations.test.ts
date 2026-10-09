import { deriveBucket, pendingGrading } from '@tora/core';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import {
  DomainError,
  addNote,
  addPull,
  changeCondition,
  createHolding,
  deleteHolding,
  editHolding,
  markOpened,
  returnGrading,
  sellHolding,
  splitOff,
  submitGrading,
} from './mutations';
import { getHoldingDetail, listInventory, searchProducts } from './queries';
import { holdings } from './schema';

let db: Db;
const day = (d: string) => `2026-${d}T12:00:00.000+09:00`;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mut-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

const expectDomainError = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);

async function amiiboLot(quantity = 3, cost = 10_000) {
  return createHolding(
    db,
    { product: { type: 'amiibo', nameEn: 'amiibo Link' } },
    {
      quantity,
      costTotalJpy: cost,
      acquiredAt: day('08-01'),
      condition: 'new_unused',
      packagingState: 'sealed_no_shrink',
    },
  );
}

async function box() {
  return createHolding(
    db,
    {
      product: {
        type: 'sealed_tcg',
        nameJa: '30周年 BOX',
        setName: '30th',
        franchise: 'Pokemon',
        language: 'JP',
      },
    },
    {
      quantity: 1,
      costTotalJpy: 5_400,
      acquiredAt: day('09-28'),
      acquiredFrom: 'Yodobashi',
      packagingState: 'box_opened_contents_sealed',
    },
  );
}

describe('createHolding', () => {
  it('creates product, holding and acquired event (scenarios 1-3)', async () => {
    const { holding, product } = await amiiboLot();
    const detail = await getHoldingDetail(db, holding.id);
    expect(detail?.product.id).toBe(product.id);
    expect(detail?.events.map((e) => e.type)).toEqual(['acquired']);
    expect(detail?.events[0]?.amountJpy).toBe(10_000);

    // Reuse an existing product.
    const second = await createHolding(
      db,
      { productId: product.id },
      { quantity: 1, costTotalJpy: 3000, acquiredAt: day('08-02') },
    );
    expect(second.product.id).toBe(product.id);
  });

  it('validates input', async () => {
    await expectDomainError(
      createHolding(
        db,
        { product: { type: 'amiibo' } },
        { quantity: 1, costTotalJpy: 0, acquiredAt: day('01-01') },
      ),
      'invalid_input',
    );
    await expectDomainError(
      createHolding(
        db,
        { product: { type: 'amiibo', nameEn: 'x' } },
        { quantity: 0, costTotalJpy: 0, acquiredAt: day('01-01') },
      ),
      'invalid_quantity',
    );
    await expectDomainError(
      createHolding(
        db,
        { productId: 'missing' },
        { quantity: 1, costTotalJpy: 0, acquiredAt: day('01-01') },
      ),
      'not_found',
    );
  });
});

describe('pulls (scenarios 4-5)', () => {
  it('links pulls to the box, cost 0, inheriting set data', async () => {
    const { holding: boxHolding } = await box();
    const { holding, product } = await addPull(
      db,
      boxHolding.id,
      { product: { type: 'card_single', nameJa: 'ピカチュウ', rarity: 'SAR' } },
      { quantity: 1, rawGrade: 'A', acquiredAt: day('09-28') },
    );
    expect(holding).toMatchObject({
      parentHoldingId: boxHolding.id,
      costTotalJpy: 0,
      acquisitionType: 'pull',
      acquiredFrom: 'Yodobashi',
    });
    expect(product).toMatchObject({ setName: '30th', franchise: 'Pokemon', language: 'JP' });
    expect(deriveBucket({ productType: product.type, ...holding })).toBe('raw:A');

    const detail = await getHoldingDetail(db, boxHolding.id);
    expect(detail?.children).toHaveLength(1);
  });

  it('only allows pulls from sealed TCG', async () => {
    const { holding } = await amiiboLot();
    await expectDomainError(
      addPull(
        db,
        holding.id,
        { product: { type: 'card_single', nameEn: 'x' } },
        { quantity: 1, rawGrade: 'A', acquiredAt: day('01-01') },
      ),
      'not_sealed',
    );
  });

  it('opening the packs consumes the box but keeps the received state in history', async () => {
    const { holding } = await box();
    const opened = await markOpened(db, holding.id, {
      quantity: 1,
      packagingState: 'opened',
      occurredAt: day('09-29'),
    });
    expect(opened).toMatchObject({ packagingState: 'opened', status: 'consumed' });
    const detail = await getHoldingDetail(db, holding.id);
    expect(detail?.events[0]?.payload).toMatchObject({
      packagingState: 'box_opened_contents_sealed',
    });
  });
});

describe('lot actions', () => {
  it('splits with cost allocation and history on both sides', async () => {
    const { holding } = await amiiboLot(3, 10_000);
    const split = await splitOff(db, holding.id, 1, day('09-01'));
    const [original] = await db.select().from(holdings).where(eq(holdings.id, holding.id));
    expect(original).toMatchObject({ quantity: 2, costTotalJpy: 6667 });
    expect(split).toMatchObject({ quantity: 1, costTotalJpy: 3333, productId: holding.productId });
    expect((await getHoldingDetail(db, split.id))?.events.map((e) => e.type)).toEqual(['split']);
    await expectDomainError(splitOff(db, holding.id, 2), 'invalid_quantity');
  });

  it('sells part of a lot by splitting first', async () => {
    const { holding } = await amiiboLot(3, 9_000);
    const sold = await sellHolding(db, holding.id, {
      quantity: 1,
      priceJpy: 5_000,
      feesJpy: 500,
      platform: 'Mercari',
      occurredAt: day('10-01'),
    });
    expect(sold).toMatchObject({ status: 'sold', quantity: 1, costTotalJpy: 3_000 });
    const detail = await getHoldingDetail(db, sold.id);
    expect(detail?.events.at(-1)).toMatchObject({
      type: 'sold',
      amountJpy: 5_000,
      feesJpy: 500,
      payload: { platform: 'Mercari', costBasisJpy: 3_000 },
    });
    await expectDomainError(
      sellHolding(db, sold.id, { quantity: 1, priceJpy: 1, feesJpy: 0, occurredAt: day('10-02') }),
      'not_owned',
    );
    expect(await listInventory(db, { status: 'owned' })).toHaveLength(1);
  });

  it('changes condition of part of a lot', async () => {
    const { holding } = await amiiboLot(2, 6_000);
    const changed = await changeCondition(db, holding.id, {
      quantity: 1,
      condition: 'minor_damage',
      occurredAt: day('10-01'),
    });
    expect(changed).toMatchObject({ condition: 'minor_damage', quantity: 1, costTotalJpy: 3_000 });
    await expectDomainError(
      changeCondition(db, changed.id, {
        quantity: 1,
        condition: 'minor_damage',
        occurredAt: day('10-02'),
      }),
      'no_change',
    );
  });

  it('edits facts and logs before/after', async () => {
    const { holding } = await amiiboLot();
    await editHolding(db, holding.id, { costTotalJpy: 9_900, acquiredFrom: 'Amazon' });
    const detail = await getHoldingDetail(db, holding.id);
    expect(detail?.holding.costTotalJpy).toBe(9_900);
    expect(detail?.events.at(-1)?.payload).toMatchObject({
      kind: 'edit',
      changes: { costTotalJpy: { before: 10_000, after: 9_900 } },
    });
    await expectDomainError(editHolding(db, holding.id, { costTotalJpy: 9_900 }), 'no_change');
  });

  it('adds notes', async () => {
    const { holding } = await amiiboLot();
    await addNote(db, holding.id, { text: 'Stored in box 3', occurredAt: day('10-01') });
    await expectDomainError(
      addNote(db, holding.id, { text: ' ', occurredAt: day('10-01') }),
      'invalid_input',
    );
  });

  it('deletes mistakes but not holdings others depend on', async () => {
    const { holding } = await amiiboLot();
    const split = await splitOff(db, holding.id, 1);
    await expectDomainError(deleteHolding(db, holding.id), 'has_dependents');
    const { holding: fresh } = await amiiboLot(1, 100);
    await deleteHolding(db, fresh.id);
    expect(await getHoldingDetail(db, fresh.id)).toBeNull();
    expect(split.id).toBeTruthy();

    const { holding: boxHolding } = await box();
    await addPull(
      db,
      boxHolding.id,
      { product: { type: 'card_single', nameEn: 'Mew' } },
      { quantity: 1, rawGrade: 'A', acquiredAt: day('09-28') },
    );
    await expectDomainError(deleteHolding(db, boxHolding.id), 'has_dependents');
  });
});

describe('grading (scenario 6)', () => {
  it('adds the fee to cost, then records the grade', async () => {
    const { holding: boxHolding } = await box();
    const { holding: pull } = await addPull(
      db,
      boxHolding.id,
      { product: { type: 'card_single', nameJa: 'ミュウ' } },
      { quantity: 2, rawGrade: 'A', acquiredAt: day('09-28') },
    );

    const atPsa = await submitGrading(db, pull.id, {
      quantity: 1,
      grader: 'PSA',
      feeJpy: 4_000,
      occurredAt: day('10-01'),
    });
    expect(atPsa).toMatchObject({
      quantity: 1,
      costTotalJpy: 4_000,
      parentHoldingId: boxHolding.id,
    });
    const submitted = await getHoldingDetail(db, atPsa.id);
    expect(pendingGrading(submitted!.events)).toMatchObject({ grader: 'PSA' });
    await expectDomainError(
      submitGrading(db, atPsa.id, {
        quantity: 1,
        grader: 'PSA',
        feeJpy: 1,
        occurredAt: day('10-02'),
      }),
      'already_at_grader',
    );
    await expectDomainError(
      returnGrading(db, pull.id, { grader: 'PSA', grade: '10', occurredAt: day('11-01') }),
      'not_at_grader',
    );

    const graded = await returnGrading(db, atPsa.id, {
      grader: 'PSA',
      grade: '10',
      certNumber: '12345678',
      extraFeeJpy: 500,
      occurredAt: day('11-15'),
    });
    expect(graded).toMatchObject({ grading: 'graded', grade: '10', costTotalJpy: 4_500 });
    expect(deriveBucket({ productType: 'card_single', ...graded })).toBe('graded:PSA:10');

    const detail = await getHoldingDetail(db, atPsa.id);
    expect(detail?.events.map((e) => e.type)).toEqual([
      'split',
      'grading_submitted',
      'grading_returned',
    ]);
    expect(pendingGrading(detail!.events)).toBeNull();
  });

  it('refuses non-cards', async () => {
    const { holding } = await amiiboLot();
    await expectDomainError(
      submitGrading(db, holding.id, {
        quantity: 1,
        grader: 'PSA',
        feeJpy: 0,
        occurredAt: day('10-01'),
      }),
      'not_a_card',
    );
  });
});

describe('search', () => {
  it('matches names case-insensitively and escapes wildcards', async () => {
    await amiiboLot();
    await box();
    expect(await searchProducts(db, 'LINK')).toHaveLength(1);
    expect(await searchProducts(db, '30周年')).toHaveLength(1);
    expect(await searchProducts(db, '%')).toHaveLength(0);
    expect(await searchProducts(db, 'link', { types: ['sealed_tcg'] })).toHaveLength(0);
    expect(await listInventory(db, { q: 'link', type: 'amiibo' })).toHaveLength(1);
  });
});
