// `pnpm demo <username>`: fills (or resets) a demo account with sample lots, to show Tora without
// showing anyone's real collection. Only accounts named demo* are touched; their lots and notices
// are replaced (settings such as notice levels are kept). Items are real products (so the
// collectors give them real prices) and are kept across resets, with their price sources: create
// the account first (`pnpm user create demo`), run this, then a collect for the prices.
//
// Price sources are found like for any item: the collectors' matching runs, then each item is
// settled by the state it is meant to show: "complete" items get their best suggestion of each
// source confirmed (when it scores high), "confirm" items keep theirs waiting, "missing" items
// have their main source's suggestions rejected (the "paste a link" notice).
//
// The mix shows the whole app: graded and raw cards, sealed boxes (one opened, with pulls), decks,
// games, a console, sold lots, and every kind of notice (no grade, no condition, main source
// missing or to confirm, import review, a failed link, a data review suggestion, a "don't warn").
import { toTokyoIso } from '@tora/core';
import {
  type HoldingInput,
  type ProductInput,
  addPull,
  addPurchaseLinks,
  confirmCandidate,
  createDb,
  createHolding,
  getProduct,
  getUserByUsername,
  listPendingCandidates,
  listProductSources,
  loadSourceRegistry,
  markOpened,
  refreshBucketValues,
  rejectCandidate,
  runSnapshots,
  schema,
  sellHolding,
  setManualPrice,
  setSourceWarningDismissed,
  stableSourceFor,
} from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { loadAndRegister } from '../registry';
import { runCollector } from '../runner';

const {
  cancelledOrders,
  holdingEvents,
  holdings,
  importRuns,
  manualPrices,
  products,
  purchaseLinks,
  sourceWarningDismissals,
  suggestions,
  valuationSnapshots,
} = schema;

loadRootEnv();
const config = dbConfigFromEnv();
const db = createDb(config);
await exitIfUnmigrated(db);
const username = process.argv[2]?.trim().toLowerCase();
if (!username?.startsWith('demo')) {
  console.error('Usage: pnpm demo <username> (only accounts whose name starts with "demo")');
  process.exit(1);
}
const user = await getUserByUsername(db, username);
if (!user) {
  console.error(`No account "${username}": create it first with pnpm user create ${username}`);
  process.exit(1);
}
const uid = user.id;
console.log(
  `Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}; account ${username}`,
);

// --- reset: this account's own data only ------------------------------------------------------
const lotIds = (
  await db.select({ id: holdings.id }).from(holdings).where(eq(holdings.userId, uid))
).map((h) => h.id);
for (let i = 0; i < lotIds.length; i += 200) {
  const ids = lotIds.slice(i, i + 200);
  await db.delete(valuationSnapshots).where(inArray(valuationSnapshots.holdingId, ids));
  await db.delete(holdingEvents).where(inArray(holdingEvents.holdingId, ids));
}
await db.delete(purchaseLinks).where(eq(purchaseLinks.userId, uid));
// Pulls first: they point at their box.
await db.delete(holdings).where(and(eq(holdings.userId, uid), isNotNull(holdings.parentHoldingId)));
await db.delete(holdings).where(eq(holdings.userId, uid));
await db.delete(importRuns).where(eq(importRuns.userId, uid));
await db.delete(suggestions).where(eq(suggestions.userId, uid));
await db.delete(sourceWarningDismissals).where(eq(sourceWarningDismissals.userId, uid));
await db.delete(manualPrices).where(eq(manualPrices.userId, uid));
await db.delete(cancelledOrders).where(eq(cancelledOrders.userId, uid));
console.log(`reset: ${lotIds.length} lot(s) removed`);

// --- items ------------------------------------------------------------------------------------
const DAY = 86_400_000;
const ago = (days: number) => toTokyoIso(new Date(Date.now() - days * DAY));
const jp = { franchise: 'pokemon', region: 'jp' } as const;
const card = (
  name: string,
  setCode: string,
  setName: string,
  cardNumber: string,
  rarity: string,
): ProductInput => ({
  category: 'tcg',
  kind: 'single',
  ...jp,
  name,
  setCode,
  setName,
  cardNumber,
  rarity,
});
const sealed = (
  kind: 'booster_box' | 'deck' | 'special_set' | 'supply',
  name: string,
  setCode: string | null = null,
): ProductInput => ({ category: 'tcg', kind, ...jp, name, setCode });
const game = (
  kind: 'software' | 'console' | 'controller' | 'amiibo' | 'other',
  name: string,
  platform: string | null,
  extra: Partial<ProductInput> = {},
): ProductInput => ({ category: 'game', kind, name, platform, ...extra });

const S151 = '強化拡張パック「ポケモンカード151」';
const SHINY = 'ハイクラスパック「シャイニートレジャーex」';
const TERA = 'ハイクラスパック「テラスタルフェスex」';

/** The account's item for this product: the one made by an earlier run, else a new one. */
async function productRef(p: ProductInput) {
  const [found] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.createdBy, uid),
        eq(products.category, p.category),
        eq(products.kind, p.kind),
        eq(products.name, p.name),
        p.cardNumber ? eq(products.cardNumber, p.cardNumber) : isNull(products.cardNumber),
      ),
    );
  return found ? { productId: found.id } : { product: p };
}

/** What each item should look like once settled (see the header). */
type State = 'complete' | 'confirm' | 'missing';
const states = new Map<string, { state: State; costJpy: number }>();

async function lot(
  p: ProductInput,
  input: Omit<HoldingInput, 'acquiredAt'> & { days: number; state?: State },
) {
  const { days, state = 'complete', ...rest } = input;
  const made = await createHolding(db, uid, await productRef(p), {
    acquiredFrom: p.category === 'tcg' ? 'SNKRDUNK' : 'メルカリ',
    ...rest,
    acquiredAt: ago(days),
  });
  const had = states.get(made.product.id);
  states.set(made.product.id, {
    // Another lot of the item (e.g. one in the import review) keeps the item's state.
    state: had ? had.state : state,
    costJpy: (had?.costJpy ?? 0) + rest.costTotalJpy,
  });
  return made;
}

const graded = (grade: string) => ({ grading: 'graded' as const, grader: 'PSA' as const, grade });
const raw = (rawGrade: 'S' | 'A' | 'B') => ({ grading: 'raw' as const, rawGrade });

// Cards: graded, raw, and some without a grade (not valued until they get one).
await lot(card('リザードンex', 'SV2a', S151, '201/165', 'SAR'), {
  quantity: 1,
  costTotalJpy: 68_000,
  days: 400,
  ...graded('10'),
});
await lot(card('ミュウex', 'SV2a', S151, '205/165', 'SAR'), {
  quantity: 1,
  costTotalJpy: 18_000,
  days: 380,
  ...raw('A'),
});
await lot(card('フシギバナex', 'SV2a', S151, '200/165', 'SAR'), {
  quantity: 1,
  costTotalJpy: 12_500,
  state: 'confirm',
  days: 210,
  ...raw('A'),
});
// Imported with a bare name: the data review suggests its set and number.
const blastoise = await lot(
  { category: 'tcg', kind: 'single', ...jp, name: 'カメックスex' },
  { quantity: 1, costTotalJpy: 13_000, days: 120 },
);
await lot(card('ナンジャモ', 'SV4a', SHINY, '350/190', 'SAR'), {
  quantity: 2,
  costTotalJpy: 11_000,
  days: 300,
  ...raw('S'),
});
await lot(card('サーナイトex', 'SV4a', SHINY, '348/190', 'SAR'), {
  quantity: 1,
  costTotalJpy: 21_000,
  days: 280,
  ...graded('9'),
});
await lot(card('ブラッキーVMAX', 'S6a', '強化拡張パック「イーブイヒーローズ」', '095/069', 'HR'), {
  quantity: 1,
  costTotalJpy: 380_000,
  days: 330,
  ...graded('10'),
});
const marnie = await lot(card('マリィ', 'S1H', '拡張パック「シールド」', '068/060', 'SR'), {
  quantity: 1,
  costTotalJpy: 25_000,
  days: 250,
  ...raw('B'),
});
await lot(card('ピカチュウex', 'SV8', '拡張パック「超電ブレイカー」', '132/106', 'SAR'), {
  quantity: 1,
  costTotalJpy: 42_000,
  state: 'missing',
  days: 60,
  ...raw('A'),
});
await lot(card('ブラッキーex', 'SV8a', TERA, '217/187', 'SAR'), {
  quantity: 1,
  costTotalJpy: 29_000,
  state: 'confirm',
  days: 45,
});
await lot(card('ニンフィアex', 'SV8a', TERA, '212/187', 'SAR'), {
  quantity: 1,
  costTotalJpy: 11_800,
  days: 90,
  ...raw('A'),
});
const dragapult = await lot(card('ドラパルトex', 'SV8a', TERA, '221/187', 'SAR'), {
  quantity: 2,
  costTotalJpy: 5_200,
  days: 200,
  ...raw('A'),
});
const rayquaza = await lot(
  card('レックウザVMAX', 'S7R', '拡張パック「蒼空ストリーム」', '083/067', 'HR'),
  {
    quantity: 1,
    costTotalJpy: 300_000,
    days: 420,
    ...graded('10'),
  },
);

// Sealed product.
const box151 = sealed(
  'booster_box',
  `ポケモンカードゲーム スカーレット&バイオレット ${S151}ボックス`,
  'SV2a',
);
await lot(box151, {
  quantity: 2,
  costTotalJpy: 27_000,
  days: 410,
  packagingState: 'sealed_shrink',
});
// One box opened, with what came out of it.
const opened = await lot(box151, {
  quantity: 1,
  costTotalJpy: 14_000,
  days: 395,
  packagingState: 'sealed_shrink',
});
await addPull(
  db,
  uid,
  opened.holding.id,
  { card: { name: 'ピカチュウ', cardNumber: '173/165', rarity: 'AR' } },
  { quantity: 1, rawGrade: 'A', acquiredAt: ago(394) },
);
await addPull(
  db,
  uid,
  opened.holding.id,
  { card: { name: 'ミュウex', cardNumber: '151/165', rarity: 'RR' } },
  { quantity: 1, rawGrade: 'A', acquiredAt: ago(394) },
);
await markOpened(db, uid, opened.holding.id, {
  quantity: 1,
  packagingState: 'opened',
  occurredAt: ago(394),
});
await lot(
  sealed('booster_box', `ポケモンカードゲーム スカーレット&バイオレット ${SHINY}ボックス`, 'SV4a'),
  {
    quantity: 1,
    costTotalJpy: 9_800,
    days: 310,
    packagingState: 'sealed_shrink',
  },
);
await lot(
  sealed(
    'booster_box',
    'ポケモンカードゲーム スカーレット&バイオレット 拡張パック「黒炎の支配者」ボックス',
    'SV3',
  ),
  {
    quantity: 1,
    costTotalJpy: 7_500,
    days: 360,
    packagingState: 'sealed_no_shrink',
  },
);
await lot(
  sealed(
    'booster_box',
    'ポケモンカードゲーム ソード&シールド ハイクラスパック「VSTARユニバース」ボックス',
    'S12a',
  ),
  {
    quantity: 1,
    costTotalJpy: 16_500,
    state: 'confirm',
    days: 430,
    packagingState: 'sealed_shrink',
  },
);
await lot(
  sealed(
    'booster_box',
    'ポケモンカードゲーム スカーレット&バイオレット 拡張パック「変幻の仮面」ボックス',
    'SV6',
  ),
  {
    quantity: 2,
    costTotalJpy: 11_000,
    state: 'missing',
    days: 150,
    packagingState: 'sealed_shrink',
  },
);
await lot(
  sealed(
    'booster_box',
    'ポケモンカードゲーム スカーレット&バイオレット 拡張パック「クレイバースト」ボックス',
    'SV2D',
  ),
  {
    quantity: 1,
    costTotalJpy: 6_200,
    days: 440,
    packagingState: 'sealed_shrink',
  },
);
await lot(
  sealed(
    'deck',
    'ポケモンカードゲーム スカーレット&バイオレット スタートデッキ Generations「ピカチュウex・カビゴンex」',
  ),
  {
    quantity: 1,
    costTotalJpy: 1_650,
    days: 100,
    packagingState: 'sealed_shrink',
  },
);
await lot(
  sealed(
    'special_set',
    'ポケモンカードゲーム スカーレット&バイオレット スタートデッキ Generations「スペシャルバトルセット」',
  ),
  {
    quantity: 1,
    costTotalJpy: 5_500,
    state: 'confirm',
    days: 95,
    packagingState: 'sealed_shrink',
  },
);
await lot(sealed('supply', 'ポケモンカードゲーム デッキシールド ピカチュウ'), {
  quantity: 2,
  costTotalJpy: 1_320,
  days: 70,
  condition: 'new_unused',
});

// Games: some without a condition (not valued until they get one).
await lot(game('software', 'ゼルダの伝説 ティアーズ オブ ザ キングダム', 'switch'), {
  quantity: 1,
  costTotalJpy: 5_500,
  days: 340,
  condition: 'like_new',
});
await lot(game('software', 'スプラトゥーン3', 'switch'), {
  quantity: 1,
  costTotalJpy: 4_800,
  days: 300,
  condition: 'new_unused',
});
await lot(game('software', 'ポケットモンスター スカーレット', 'switch'), {
  quantity: 1,
  costTotalJpy: 4_200,
  state: 'confirm',
  days: 280,
});
await lot(game('software', 'マリオカート8 デラックス', 'switch'), {
  quantity: 1,
  costTotalJpy: 2_500,
  days: 260,
  condition: 'no_noticeable_damage',
});
await lot(game('software', '大乱闘スマッシュブラザーズ SPECIAL', 'switch'), {
  quantity: 1,
  costTotalJpy: 4_000,
  state: 'confirm',
  days: 240,
});
await lot(game('software', 'ELDEN RING エルデンリング', 'ps5'), {
  quantity: 1,
  costTotalJpy: 3_900,
  state: 'missing',
  days: 220,
  condition: 'like_new',
});
const ff16 = await lot(game('software', 'ファイナルファンタジーXVI', 'ps5'), {
  quantity: 1,
  costTotalJpy: 6_800,
  days: 330,
  condition: 'like_new',
});
// Platform missing: the data review suggests it.
const mario64 = await lot(game('software', 'スーパーマリオ64', null), {
  quantity: 1,
  costTotalJpy: 3_500,
  days: 180,
  condition: 'minor_damage',
});
await lot(game('software', 'ポケットモンスター X', '3ds'), {
  quantity: 1,
  costTotalJpy: 1_800,
  days: 160,
});
await lot(game('console', 'Nintendo Switch 有機ELモデル ホワイト', 'switch'), {
  quantity: 1,
  costTotalJpy: 32_000,
  days: 390,
  condition: 'like_new',
});
await lot(game('controller', 'Nintendo Switch Proコントローラー', 'switch'), {
  quantity: 1,
  costTotalJpy: 6_000,
  days: 370,
});
await lot(
  game('amiibo', 'amiibo リンク【ティアーズ オブ ザ キングダム】', null, { retailPriceJpy: 3_300 }),
  { quantity: 1, costTotalJpy: 3_300, days: 330, condition: 'new_unused' },
);
// No shop lists it: the "not linked" warning is turned off.
const watch = await lot(game('other', 'ポケモン ピカチュウ 腕時計 (非売品)', null), {
  quantity: 1,
  costTotalJpy: 8_000,
  state: 'missing',
  days: 200,
  condition: 'like_new',
});
await setSourceWarningDismissed(db, uid, watch.product.id, true);

// Sold: realized gains and losses.
await sellHolding(db, uid, rayquaza.holding.id, {
  quantity: 1,
  priceJpy: 455_000,
  feesJpy: 31_850,
  platform: 'SNKRDUNK',
  occurredAt: ago(30),
});
await sellHolding(db, uid, dragapult.holding.id, {
  quantity: 1,
  priceJpy: 2_300,
  feesJpy: 230,
  platform: 'メルカリ',
  occurredAt: ago(20),
});
await sellHolding(db, uid, ff16.holding.id, {
  quantity: 1,
  priceJpy: 3_200,
  feesJpy: 320,
  platform: 'メルカリ',
  occurredAt: ago(50),
});

// A price set by hand.
await setManualPrice(db, uid, marnie.product.id, 'raw:B', 30_000);

// Notices from imports: lots to review, a link that failed, a data review suggestion.
await lot(card('リザードンex', 'SV2a', S151, '201/165', 'SAR'), {
  quantity: 1,
  costTotalJpy: 41_000,
  days: 5,
  ...raw('A'),
  reviewPending: true,
  reviewReason: 'date_approx',
  orderId: 'DEMO-1001',
});
await lot(game('software', 'スプラトゥーン3', 'switch'), {
  quantity: 1,
  costTotalJpy: 3_600,
  days: 4,
  condition: 'like_new',
  reviewPending: true,
  reviewReason: 'price_far',
});
await addPurchaseLinks(db, uid, ['https://jp.mercari.com/item/m10000000000']);
await db
  .update(purchaseLinks)
  .set({ status: 'failed', message: 'The listing was deleted before it could be read.' })
  .where(eq(purchaseLinks.userId, uid));
await db.insert(suggestions).values([
  {
    userId: uid,
    kind: 'fix_product',
    targetKey: blastoise.product.id,
    productId: blastoise.product.id,
    payload: {
      changes: { setName: S151, setCode: 'SV2a', cardNumber: '202/165', rarity: 'SAR' },
    },
    reason: 'The SNKRDUNK listings for this card are the 151 SAR, 202/165.',
    model: 'demo',
    confidence: 0.9,
  },
  {
    userId: uid,
    kind: 'fix_product',
    targetKey: mario64.product.id,
    productId: mario64.product.id,
    payload: { changes: { platform: 'n64' } },
    reason:
      'スーパーマリオ64 came out on the Nintendo 64 only (the DS version is スーパーマリオ64DS).',
    model: 'demo',
    confidence: 0.95,
  },
]);

const count = (await db.select({ id: holdings.id }).from(holdings).where(eq(holdings.userId, uid)))
  .length;
console.log(`demo: ${count} lot(s) created`);

// --- price sources: match like any item, then settle each by its state -----------------------
const { collectors } = await loadAndRegister(db);
const registry = await loadSourceRegistry(db);
for (const collector of collectors) {
  // Every item without a listing of this source (the account's new ones, and any other).
  const s = await runCollector(db, collector, {
    matchOnly: true,
    log: (m) => console.log(`[${collector.source}] ${m}`),
  });
  console.log(`${s.source}: ${s.status}, ${s.candidates} new suggestion(s)`);
}
/** A suggestion is confirmed for a complete item only when it scores at least this. */
const CONFIRM_MIN = 0.85;
for (const [productId, { state, costJpy }] of states) {
  const product = await getProduct(db, productId);
  if (!product) continue;
  const linked = new Set(
    (await listProductSources(db, productId)).filter((l) => l.active).map((l) => l.source),
  );
  const main = stableSourceFor(product, costJpy, registry);
  const bySource = new Map<string, Awaited<ReturnType<typeof listPendingCandidates>>>();
  for (const c of await listPendingCandidates(db, productId)) {
    if (!linked.has(c.source)) bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]);
  }
  for (const [source, list] of bySource) {
    const best = list[0]!;
    if (state === 'complete' && best.score >= CONFIRM_MIN) {
      await confirmCandidate(db, best.id);
      console.log(`confirmed ${source} for "${product.name}": ${best.title} (${best.score})`);
    } else if (state === 'missing' && source === main) {
      for (const c of list) await rejectCandidate(db, c.id);
      console.log(`rejected ${list.length} ${source} suggestion(s) for "${product.name}"`);
    }
  }
}
const snap = await runSnapshots(db);
const values = await refreshBucketValues(db);
console.log(`snapshots: ${snap.rows} row(s); values: ${values.values} saved`);
console.log('Next: pnpm collect (prices and sales history of the linked items).');
process.exit(0);
