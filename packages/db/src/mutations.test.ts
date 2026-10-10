import { deriveBucket, pendingGrading, productClass } from '@tora/core';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { syncCatalog } from './catalog';
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
  setCardGrade,
  splitOff,
  submitGrading,
  updateProduct,
} from './mutations';
import {
  getHoldingDetail,
  listInventory,
  ownedTotals,
  searchProducts,
  searchSets,
} from './queries';
import { holdings, tcgSets } from './schema';
import { createUser } from './users';

let db: Db;
let uid: string;
const day = (d: string) => `2026-${d}T12:00:00.000+09:00`;
const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mut-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  uid = (await createUser(db, 'alice', creds)).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const expectDomainError = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);

async function amiiboLot(quantity = 3, cost = 10_000, user = uid) {
  return createHolding(
    db,
    user,
    { product: { category: 'game', kind: 'amiibo', name: 'amiibo Link', region: 'jp' } },
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
    uid,
    {
      product: {
        category: 'tcg',
        kind: 'booster_box',
        name: '30周年 BOX',
        setName: '30th',
        franchise: 'pokemon',
        region: 'jp',
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

const pull = (boxId: string, name: string, quantity = 1) =>
  addPull(
    db,
    uid,
    boxId,
    { card: { name } },
    { quantity, rawGrade: 'A', acquiredAt: day('09-28') },
  );

describe('createHolding', () => {
  it('creates product, holding and acquired event (scenarios 1-3)', async () => {
    const { holding, product } = await amiiboLot();
    expect(product.createdBy).toBe(uid);
    const detail = await getHoldingDetail(db, uid, holding.id);
    expect(detail?.product.id).toBe(product.id);
    expect(detail?.events.map((e) => e.type)).toEqual(['acquired']);

    const second = await createHolding(
      db,
      uid,
      { productId: product.id },
      { quantity: 1, costTotalJpy: 3000, acquiredAt: day('08-02') },
    );
    expect(second.product.id).toBe(product.id);
    expect(await ownedTotals(db, uid)).toEqual({ spentJpy: 13_000, lots: 2, units: 4 });
  });

  it('validates input', async () => {
    const h = { quantity: 1, costTotalJpy: 0, acquiredAt: day('01-01') };
    await expectDomainError(
      createHolding(db, uid, { product: { category: 'game', kind: 'amiibo', name: ' ' } }, h),
      'invalid_input',
    );
    await expectDomainError(
      createHolding(db, uid, { product: { category: 'game', kind: 'booster_box', name: 'x' } }, h),
      'invalid_input',
    );
    await expectDomainError(
      createHolding(
        db,
        uid,
        { product: { category: 'game', kind: 'amiibo', name: 'x' } },
        { ...h, quantity: 0 },
      ),
      'invalid_quantity',
    );
    await expectDomainError(createHolding(db, uid, { productId: 'missing' }, h), 'not_found');
  });
});

describe('catalog products', () => {
  async function seedSets() {
    await syncCatalog(db, [
      {
        franchise: 'pokemon',
        region: 'jp',
        code: 'SV9',
        name: 'バトルパートナーズ',
        nameAlias: 'Battle Partners',
        setType: 'expansion',
        releaseDate: '2025-01-24',
        source: 't',
        sourceKey: 'sv9',
      },
      {
        franchise: 'mtg',
        region: null,
        code: 'BLB',
        name: 'Bloomburrow',
        nameAlias: null,
        setType: 'expansion',
        releaseDate: '2024-08-02',
        source: 's',
        sourceKey: 'blb',
      },
      {
        franchise: 'pokemon',
        region: 'jp',
        code: 'D1',
        name: 'スタートデッキ',
        nameAlias: null,
        setType: 'deck',
        releaseDate: '2024-01-01',
        source: 't',
        sourceKey: 'd1',
      },
    ]);
    return Object.fromEntries((await db.select().from(tcgSets)).map((s) => [s.code, s]));
  }

  it('creates the sealed product once per set + kind + variant + region', async () => {
    const sets = await seedSets();
    const h = {
      quantity: 1,
      costTotalJpy: 5_000,
      acquiredAt: day('09-01'),
      packagingState: 'sealed_shrink' as const,
    };
    const a = await createHolding(
      db,
      uid,
      { catalog: { setId: sets.SV9!.id, kind: 'booster_box' } },
      h,
    );
    const b = await createHolding(
      db,
      uid,
      { catalog: { setId: sets.SV9!.id, kind: 'booster_box' } },
      h,
    );
    expect(a.product.id).toBe(b.product.id);
    expect(a.product).toMatchObject({
      name: 'バトルパートナーズ BOX',
      nameAlias: 'Battle Partners Booster Box',
      category: 'tcg',
      franchise: 'pokemon',
      region: 'jp',
      setCode: 'SV9',
      releaseDate: '2025-01-24',
      createdBy: null,
    });
    const pack = await createHolding(
      db,
      uid,
      { catalog: { setId: sets.SV9!.id, kind: 'booster_pack' } },
      h,
    );
    expect(pack.product.name).toBe('バトルパートナーズ パック');

    const play = await createHolding(
      db,
      uid,
      { catalog: { setId: sets.BLB!.id, kind: 'booster_box', region: 'jp' } },
      h,
    );
    const collector = await createHolding(
      db,
      uid,
      { catalog: { setId: sets.BLB!.id, kind: 'booster_box', variant: 'Collector', region: 'jp' } },
      h,
    );
    const en = await createHolding(
      db,
      uid,
      { catalog: { setId: sets.BLB!.id, kind: 'booster_box', region: 'en' } },
      h,
    );
    expect(new Set([play.product.id, collector.product.id, en.product.id]).size).toBe(3);
    expect(collector.product.name).toBe('Bloomburrow Collector Booster Box');

    await expectDomainError(
      createHolding(db, uid, { catalog: { setId: sets.D1!.id, kind: 'booster_box' } }, h),
      'invalid_input',
    );
    expect(await searchProducts(db, 'battle partners')).toHaveLength(2);
  });

  it('searches sets by franchise and region, newest first', async () => {
    await seedSets();
    expect(
      (await searchSets(db, { franchise: 'pokemon', region: 'jp' })).map((s) => s.code),
    ).toEqual(['SV9', 'D1']);
    expect(await searchSets(db, { franchise: 'pokemon', region: 'jp', q: 'battle' })).toHaveLength(
      1,
    );
    expect(await searchSets(db, { franchise: 'mtg', region: 'en' })).toHaveLength(1);
  });
});

describe('users', () => {
  it("cannot see or change another user's holdings", async () => {
    const { holding } = await amiiboLot();
    const bob = (await createUser(db, 'bob', creds)).user.id;
    expect(await getHoldingDetail(db, bob, holding.id)).toBeNull();
    expect(await listInventory(db, bob)).toHaveLength(0);
    await expectDomainError(splitOff(db, bob, holding.id, 1), 'not_found');
    await expectDomainError(deleteHolding(db, bob, holding.id), 'not_found');
    await amiiboLot(1, 100, bob);
    expect(await listInventory(db, uid)).toHaveLength(1);
  });

  it('lets only the creator or an admin edit a shared product', async () => {
    const { product } = await amiiboLot();
    const bob = (await createUser(db, 'bob', creds)).user;
    const input = { category: 'game' as const, kind: 'amiibo' as const, name: 'Renamed' };
    expect(bob.role).toBe('member');
    await expectDomainError(updateProduct(db, bob, product.id, input), 'forbidden');
    await updateProduct(db, { id: uid, role: 'member' }, product.id, input);
  });
});

describe('pulls (scenarios 4-5)', () => {
  it('links pulls to the box, cost 0, inheriting set data', async () => {
    const { holding: boxHolding } = await box();
    const { holding, product } = await pull(boxHolding.id, 'ピカチュウ');
    expect(holding).toMatchObject({
      parentHoldingId: boxHolding.id,
      costTotalJpy: 0,
      acquisitionType: 'pull',
      acquiredFrom: 'Yodobashi',
      userId: uid,
    });
    expect(product).toMatchObject({
      kind: 'single',
      setName: '30th',
      franchise: 'pokemon',
      region: 'jp',
    });
    expect(deriveBucket({ productClass: productClass(product), ...holding })).toBe('raw:A');
    expect((await getHoldingDetail(db, uid, boxHolding.id))?.children).toHaveLength(1);
  });

  it('only allows pulls from sealed TCG', async () => {
    const { holding } = await amiiboLot();
    await expectDomainError(pull(holding.id, 'x'), 'not_sealed');
  });

  it('opening the packs consumes the box but keeps the received state in history', async () => {
    const { holding } = await box();
    const opened = await markOpened(db, uid, holding.id, {
      quantity: 1,
      packagingState: 'opened',
      occurredAt: day('09-29'),
    });
    expect(opened).toMatchObject({ packagingState: 'opened', status: 'consumed' });
    const detail = await getHoldingDetail(db, uid, holding.id);
    expect(detail?.events[0]?.payload).toMatchObject({
      packagingState: 'box_opened_contents_sealed',
    });
  });
});

describe('lot actions', () => {
  it('splits with cost allocation and history on both sides', async () => {
    const { holding } = await amiiboLot(3, 10_000);
    const split = await splitOff(db, uid, holding.id, 1, day('09-01'));
    const [original] = await db.select().from(holdings).where(eq(holdings.id, holding.id));
    expect(original).toMatchObject({ quantity: 2, costTotalJpy: 6667 });
    expect(split).toMatchObject({ quantity: 1, costTotalJpy: 3333, userId: uid });
    expect((await getHoldingDetail(db, uid, split.id))?.events.map((e) => e.type)).toEqual([
      'split',
    ]);
    await expectDomainError(splitOff(db, uid, holding.id, 2), 'invalid_quantity');
  });

  it('sells part of a lot by splitting first', async () => {
    const { holding } = await amiiboLot(3, 9_000);
    const sold = await sellHolding(db, uid, holding.id, {
      quantity: 1,
      priceJpy: 5_000,
      feesJpy: 500,
      platform: 'Mercari',
      occurredAt: day('10-01'),
    });
    expect(sold).toMatchObject({ status: 'sold', quantity: 1, costTotalJpy: 3_000 });
    expect((await getHoldingDetail(db, uid, sold.id))?.events.at(-1)).toMatchObject({
      type: 'sold',
      amountJpy: 5_000,
      feesJpy: 500,
      payload: { platform: 'Mercari', costBasisJpy: 3_000 },
    });
    await expectDomainError(
      sellHolding(db, uid, sold.id, {
        quantity: 1,
        priceJpy: 1,
        feesJpy: 0,
        occurredAt: day('10-02'),
      }),
      'not_owned',
    );
    expect(await listInventory(db, uid, { status: 'owned' })).toHaveLength(1);
    expect((await ownedTotals(db, uid)).spentJpy).toBe(6_000);
  });

  it('changes condition of part of a lot', async () => {
    const { holding } = await amiiboLot(2, 6_000);
    const changed = await changeCondition(db, uid, holding.id, {
      quantity: 1,
      condition: 'minor_damage',
      occurredAt: day('10-01'),
    });
    expect(changed).toMatchObject({ condition: 'minor_damage', quantity: 1, costTotalJpy: 3_000 });
    await expectDomainError(
      changeCondition(db, uid, changed.id, {
        quantity: 1,
        condition: 'minor_damage',
        occurredAt: day('10-02'),
      }),
      'no_change',
    );
  });

  it('edits facts and logs before/after; adds notes', async () => {
    const { holding } = await amiiboLot();
    await editHolding(db, uid, holding.id, { costTotalJpy: 9_900, acquiredFrom: 'Amazon' });
    const detail = await getHoldingDetail(db, uid, holding.id);
    expect(detail?.events.at(-1)?.payload).toMatchObject({
      kind: 'edit',
      changes: { costTotalJpy: { before: 10_000, after: 9_900 } },
    });
    await expectDomainError(editHolding(db, uid, holding.id, { costTotalJpy: 9_900 }), 'no_change');
    await addNote(db, uid, holding.id, { text: 'Box 3', occurredAt: day('10-01') });
    await expectDomainError(
      addNote(db, uid, holding.id, { text: ' ', occurredAt: day('10-01') }),
      'invalid_input',
    );
  });

  it('deletes mistakes but not holdings others depend on', async () => {
    const { holding } = await amiiboLot();
    await splitOff(db, uid, holding.id, 1);
    await expectDomainError(deleteHolding(db, uid, holding.id), 'has_dependents');
    const { holding: fresh } = await amiiboLot(1, 100);
    await deleteHolding(db, uid, fresh.id);
    expect(await getHoldingDetail(db, uid, fresh.id)).toBeNull();
    const { holding: boxHolding } = await box();
    await pull(boxHolding.id, 'Mew');
    await expectDomainError(deleteHolding(db, uid, boxHolding.id), 'has_dependents');
  });
});

describe('grading (scenario 6)', () => {
  it('adds the fee to cost, then records the grade', async () => {
    const { holding: boxHolding } = await box();
    const { holding: mew } = await pull(boxHolding.id, 'ミュウ', 2);
    const atPsa = await submitGrading(db, uid, mew.id, {
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
    expect(pendingGrading((await getHoldingDetail(db, uid, atPsa.id))!.events)).toMatchObject({
      grader: 'PSA',
    });
    await expectDomainError(
      submitGrading(db, uid, atPsa.id, {
        quantity: 1,
        grader: 'PSA',
        feeJpy: 1,
        occurredAt: day('10-02'),
      }),
      'already_at_grader',
    );
    await expectDomainError(
      returnGrading(db, uid, mew.id, { grader: 'PSA', grade: '10', occurredAt: day('11-01') }),
      'not_at_grader',
    );
    const graded = await returnGrading(db, uid, atPsa.id, {
      grader: 'PSA',
      grade: '10',
      certNumber: '12345678',
      extraFeeJpy: 500,
      occurredAt: day('11-15'),
    });
    expect(graded).toMatchObject({ grading: 'graded', grade: '10', costTotalJpy: 4_500 });
    expect(deriveBucket({ productClass: 'card', ...graded })).toBe('graded:PSA:10');
    expect((await getHoldingDetail(db, uid, atPsa.id))?.events.map((e) => e.type)).toEqual([
      'split',
      'grading_submitted',
      'grading_returned',
    ]);
  });

  it('refuses non-cards', async () => {
    const { holding } = await amiiboLot();
    await expectDomainError(
      submitGrading(db, uid, holding.id, {
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
    expect(await searchProducts(db, 'link', { kinds: ['booster_box'] })).toHaveLength(0);
    expect(await listInventory(db, uid, { q: 'link', kind: 'amiibo' })).toHaveLength(1);
    expect(await listInventory(db, uid, { category: 'tcg' })).toHaveLength(1);
  });
});

describe('setCardGrade', () => {
  it('grades several cards at once and logs each change', async () => {
    const card = {
      product: { category: 'tcg' as const, kind: 'single' as const, name: 'ピカチュウ' },
    };
    const input = { quantity: 1, costTotalJpy: 500, acquiredAt: day('09-01') };
    const a = await createHolding(db, uid, card, input);
    const b = await createHolding(db, uid, card, { ...input, grading: 'raw', rawGrade: 'B' });
    const grade = { grading: 'graded', grader: 'PSA', grade: '10' } as const;
    expect(await setCardGrade(db, uid, [a.holding.id, b.holding.id], grade)).toBe(2);
    expect(await setCardGrade(db, uid, [a.holding.id], grade)).toBe(0);
    const detail = await getHoldingDetail(db, uid, b.holding.id);
    expect(detail?.holding).toMatchObject({
      grading: 'graded',
      grader: 'PSA',
      grade: '10',
      rawGrade: null,
    });
    expect(detail?.events.some((e) => e.type === 'note')).toBe(true);

    const box = await createHolding(
      db,
      uid,
      { product: { category: 'tcg', kind: 'booster_box', name: 'Box' } },
      {
        ...input,
        packagingState: 'sealed_shrink',
      },
    );
    await expectDomainError(setCardGrade(db, uid, [box.holding.id], grade), 'not_a_card');
    const bob = (await createUser(db, 'bob', creds)).user.id;
    await expectDomainError(setCardGrade(db, bob, [a.holding.id], grade), 'not_found');
  });
});

describe('order IDs', () => {
  const card = { product: { category: 'tcg' as const, kind: 'single' as const, name: 'ミュウ' } };
  const h = (orderId: string | null, acquiredFrom = 'SNKRDUNK') => ({
    quantity: 1,
    costTotalJpy: 1000,
    acquiredAt: day('09-01'),
    acquiredFrom,
    orderId,
    grading: 'raw' as const,
    rawGrade: 'A' as const,
  });

  it('stores a normalized source and refuses a second single-item transaction', async () => {
    const { holding } = await createHolding(db, uid, card, h(' 50015606 ', 'スニダン'));
    expect(holding).toMatchObject({ orderSource: 'snkrdunk', orderId: '50015606' });
    await expectDomainError(createHolding(db, uid, card, h('50015606')), 'duplicate_order');
    // Other users, other marketplaces and multi-item orders (Amazon) are fine.
    const bob = (await createUser(db, 'bob', creds)).user.id;
    await createHolding(db, bob, card, h('50015606'));
    await createHolding(db, uid, card, h('A-1', 'Amazon'));
    await createHolding(db, uid, card, h('A-1', 'Amazon'));
  });

  it('keeps the ID on split lots and checks it on edit', async () => {
    const lot = await createHolding(db, uid, card, {
      ...h('111'),
      quantity: 2,
      costTotalJpy: 2000,
    });
    const split = await splitOff(db, uid, lot.holding.id, 1);
    expect(split.orderId).toBe('111');
    const other = await createHolding(db, uid, card, h('222'));
    await expectDomainError(
      editHolding(db, uid, other.holding.id, { orderId: '111' }),
      'duplicate_order',
    );
    const edited = await editHolding(db, uid, other.holding.id, { orderId: '333' });
    expect(edited).toMatchObject({ orderId: '333', orderSource: 'snkrdunk' });
  });
});
