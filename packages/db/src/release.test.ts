import { refreshPriceDays } from './price-days';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import {
  linkSets,
  matchSet,
  platformKey,
  releaseDates,
  setNameKey,
  similarKey,
  similarProducts,
} from './release';
import { type TcgSet, priceObservations, products, suggestions, tcgSets } from './schema';
import { decideSuggestion } from './suggestions';
import { createUser } from './users';

const set = (over: Partial<TcgSet>): TcgSet => ({
  id: over.name ?? 'x',
  franchise: 'pokemon',
  region: 'jp',
  code: null,
  name: 'x',
  nameAlias: null,
  setType: 'expansion',
  releaseDate: '2023-06-16',
  source: 'test',
  sourceKey: over.name ?? 'x',
  createdAt: '',
  updatedAt: '',
  ...over,
});

const catalog = [
  set({
    code: 'SV2A',
    name: 'ポケモンカード151(イチゴーイチ)',
    nameAlias: '強化拡張パック「ポケモンカード151(イチゴーイチ)」',
  }),
  set({
    code: 'SV2A',
    name: 'ポケモンカード151(イチゴーイチ) カードファイルセット',
    setType: 'special',
  }),
  set({ code: 'S1', name: 'シールド' }),
  set({ code: 'SV9', name: 'バトルパートナーズ' }),
  set({ name: 'デッキビルドBOX バトルパートナーズ', setType: 'special' }),
  set({ name: 'スタートデッキGenerations ピカチュウex・カビゴンex', setType: 'deck' }),
  set({ code: 'M6A', name: '30th CELEBRATION' }),
];

const item = (over: Record<string, string | null>) => ({
  kind: 'single',
  franchise: 'pokemon',
  region: 'jp' as const,
  setCode: null,
  setName: null,
  ...over,
});

describe('matchSet', () => {
  it('links by a code the catalog has once, preferring the kind of set the item comes from', () => {
    expect(
      matchSet(item({ setCode: 'SV2a', setName: 'ポケモンカード151' }), catalog).sure?.name,
    ).toBe('ポケモンカード151(イチゴーイチ)');
    expect(matchSet(item({ setCode: 'sv9' }), catalog).sure?.name).toBe('バトルパートナーズ');
  });

  it('links by an exact name, and an expansion before another product of the set', () => {
    const box = matchSet(item({ kind: 'booster_box', setName: 'バトルパートナーズ' }), catalog);
    expect(box.sure?.name).toBe('バトルパートナーズ');
    expect(
      matchSet(item({ kind: 'booster_box', setName: '30th CELEBRATION' }), catalog).sure?.code,
    ).toBe('M6A');
  });

  it('only suggests when the code and the name disagree or the name is only close', () => {
    // シールド is S1 in the catalog: S1H (its half deck) is not sure.
    const shield = matchSet(item({ setCode: 'S1H', setName: 'シールド' }), catalog);
    expect(shield.sure).toBeNull();
    expect(shield.unsure.map((s) => s.code)).toEqual(['S1']);
    const deck = matchSet(item({ kind: 'deck', setName: 'ピカチュウex・カビゴンex' }), catalog);
    expect(deck.sure).toBeNull();
    expect(deck.unsure.map((s) => s.setType)).toEqual(['deck']);
    expect(
      matchSet(item({ setCode: 'SV9', setName: 'シャイニートレジャーex' }), catalog).sure,
    ).toBeNull();
  });

  it('does not guess for a promo code or another franchise, language or kind', () => {
    expect(
      matchSet(
        item({ setCode: 'SV-P', setName: '拡張パック バトルパートナーズ Box購入キャンペーン' }),
        catalog,
      ),
    ).toEqual({ sure: null, unsure: [] });
    expect(matchSet(item({ setCode: 'SV9', region: 'en' }), catalog).sure).toBeNull();
    expect(matchSet(item({ setCode: 'SV9', franchise: 'one_piece' }), catalog).sure).toBeNull();
    expect(
      matchSet(item({ kind: 'supply', setName: 'バトルパートナーズ' }), catalog).sure,
    ).toBeNull();
  });

  it('compares names without pack words, brackets and readings', () => {
    expect(setNameKey('強化拡張パック「ポケモンカード151(イチゴーイチ)」')).toBe(
      'ポケモンカード151',
    );
    expect(setNameKey('ハイクラスパック「テラスタルフェスex」')).toBe('テラスタルフェスex');
    expect(setNameKey('クレイバースト (クレバ)')).toBe('クレイバースト');
  });
});

describe('similar items', () => {
  it('groups cards by kind, franchise and language, games by kind and platform', () => {
    const tcg = {
      category: 'tcg',
      kind: 'booster_box',
      franchise: 'pokemon',
      region: 'jp' as const,
      platform: null,
    };
    expect(similarKey(tcg)).toBe('tcg|booster_box|pokemon|jp');
    expect(similarKey({ ...tcg, franchise: null })).toBeNull();
    const game = {
      category: 'game',
      kind: 'software',
      franchise: 'zelda',
      region: 'jp' as const,
      platform: 'Nintendo Switch',
    };
    expect(similarKey(game)).toBe(
      similarKey({ ...game, platform: 'switch', region: null, franchise: null }),
    );
    expect(platformKey('PlayStation 5')).toBe('ps5');
    expect(platformKey('Nintendo Switch 2')).toBe('switch2');
    expect(platformKey('3ds')).toBe('3ds');
  });
});

describe('with a database', () => {
  let db: Db;
  let admin: string;
  let member: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tora-release-'));
    db = createDb({ url: `file:${join(dir, 'test.db')}` });
    await migrateDb(db);
    const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
    admin = (await createUser(db, 'a', creds, 'admin')).user.id;
    member = (await createUser(db, 'm', creds, 'member')).user.id;
    await db
      .insert(tcgSets)
      .values(catalog.map(({ id: _id, createdAt: _c, updatedAt: _u, ...s }) => s));
    return () => rm(dir, { recursive: true, force: true });
  });

  const card = (userId: string, over: Record<string, string>) =>
    createProduct(db, userId, {
      category: 'tcg',
      kind: 'single',
      name: 'ピカチュウ',
      franchise: 'pokemon',
      region: 'jp',
      ...over,
    });

  it('links sure matches, suggests unsure ones to the item maker, and links on accept', async () => {
    const sure = await card(member, { setCode: 'SV2a' });
    const unsure = await card(member, { setCode: 'S1H', setName: 'シールド' });
    expect(await linkSets(db)).toEqual({ linked: 1, suggested: 1 });
    const [linked] = await db.select().from(products).where(eqId(sure.id));
    expect(linked?.setId).toBeTruthy();
    // The item's own set details stay (searches do not change).
    expect(linked?.setCode).toBe('SV2a');
    const [s] = await db.select().from(suggestions);
    expect(s).toMatchObject({ userId: member, kind: 'link_set', productId: unsure.id });
    // Filed once.
    expect(await linkSets(db)).toEqual({ linked: 0, suggested: 0 });
    await decideSuggestion(db, { id: member, role: 'member' }, s!.id, true);
    const [after] = await db.select().from(products).where(eqId(unsure.id));
    expect(after?.setId).toBe((s!.payload as { setId: string }).setId);
    // Its release date is the set's now.
    expect((await releaseDates(db, [after!])).get(unsure.id)).toEqual({
      date: '2023-06-16',
      from: 'set',
    });
  });

  it('dates an item by its set, its own date, else its first kept sale', async () => {
    const own = await card(member, { releaseDate: '2020-01-02' });
    const sold = await card(member, { name: 'ミュウ' });
    const none = await card(member, { name: 'イーブイ' });
    const obs = (observedAt: string, excluded: boolean) => ({
      productId: sold.id,
      source: 'snkrdunk',
      observationType: 'sold' as const,
      priceBase: 1000,
      priceOriginal: 1000,
      currency: 'JPY',
      observedAt,
      fetchedAt: observedAt,
      excluded,
      externalRef: observedAt,
    });
    await db
      .insert(priceObservations)
      .values([
        obs('2021-03-01T10:00:00.000+09:00', true),
        obs('2021-05-01T10:00:00.000+09:00', false),
      ]);
    await refreshPriceDays(db);
    const dates = await releaseDates(db, [own, sold, none]);
    expect(dates.get(own.id)).toEqual({ date: '2020-01-02', from: 'item' });
    expect(dates.get(sold.id)).toEqual({ date: '2021-05-01', from: 'first_sale' });
    expect(dates.has(none.id)).toBe(false);
  });

  it('finds similar items from every person', async () => {
    const mine = await card(member, {});
    const theirs = await card(admin, { name: 'ミュウ' });
    await card(admin, { name: 'Pikachu', region: 'en' });
    expect((await similarProducts(db, mine)).map((p) => p.id)).toEqual([theirs.id]);
  });
});

const eqId = (id: string) => eq(products.id, id);
