// Sample data covering the requirement scenarios 1-5. Names and prices are illustrative.
import { newId } from '@tora/core';
import type { Db } from './client';
import {
  type NewHolding,
  type NewHoldingEvent,
  type NewProduct,
  holdingEvents,
  holdings,
  products,
} from './schema';

const SAMPLE_NOTE = 'Sample seed data. Edit or delete.';

interface SeedItem {
  product: NewProduct & { id: string };
  holdings: (Omit<NewHolding, 'productId'> & { id: string })[];
}

/** Builds the seed rows. Exposed separately so tests can assert on them. */
export function buildSeed() {
  const at = (date: string) => `${date}T12:00:00.000+09:00`;
  const p = () => newId();
  const h = () => newId();

  const boxHoldingId = h();
  const boxSet = 'Pokemon TCG 30th Anniversary';

  const items: SeedItem[] = [
    // Scenario 1: game collector's edition
    {
      product: {
        id: p(),
        type: 'game_ce',
        nameEn: "Fire Emblem: Fortune's Weave Collector's Edition (Switch 2)",
        franchise: 'Fire Emblem',
        notes: SAMPLE_NOTE,
      },
      holdings: [
        {
          id: h(),
          quantity: 1,
          costTotalJpy: 19_800,
          acquiredAt: at('2026-09-20'),
          acquiredFrom: 'My Nintendo Store',
          condition: 'new_unused',
          packagingState: 'sealed_shrink',
        },
      ],
    },
    // Scenario 2: amiibo, including 3 identical units in one lot
    {
      product: {
        id: p(),
        type: 'amiibo',
        nameJa: 'amiibo リンク【ティアーズ オブ ザ キングダム】',
        nameEn: 'amiibo Link (Tears of the Kingdom)',
        franchise: 'The Legend of Zelda',
        retailPriceJpy: 3_300,
        notes: SAMPLE_NOTE,
      },
      holdings: [
        {
          id: h(),
          quantity: 3,
          costTotalJpy: 9_900,
          acquiredAt: at('2026-08-01'),
          acquiredFrom: 'Yodobashi',
          condition: 'new_unused',
          packagingState: 'sealed_no_shrink',
        },
      ],
    },
    {
      product: {
        id: p(),
        type: 'amiibo',
        nameJa: 'amiibo ゼルダ【ティアーズ オブ ザ キングダム】',
        nameEn: 'amiibo Zelda (Tears of the Kingdom)',
        franchise: 'The Legend of Zelda',
        retailPriceJpy: 3_300,
        notes: SAMPLE_NOTE,
      },
      holdings: [
        {
          id: h(),
          quantity: 1,
          costTotalJpy: 2_800,
          acquiredAt: at('2026-08-15'),
          acquiredFrom: 'Mercari',
          condition: 'like_new',
          packagingState: 'opened',
        },
      ],
    },
    // Scenario 3: special edition controllers
    {
      product: {
        id: p(),
        type: 'controller',
        nameJa: 'Nintendo Switch Proコントローラー ゼノブレイド2エディション',
        nameEn: 'Nintendo Switch Pro Controller Xenoblade Chronicles 2 Edition',
        franchise: 'Xenoblade',
        notes: SAMPLE_NOTE,
      },
      holdings: [
        {
          id: h(),
          quantity: 1,
          costTotalJpy: 12_000,
          acquiredAt: at('2026-07-10'),
          acquiredFrom: 'Mercari',
          condition: 'no_noticeable_damage',
          packagingState: 'opened',
        },
      ],
    },
    {
      product: {
        id: p(),
        type: 'controller',
        nameJa: 'Nintendo Switch Proコントローラー スプラトゥーン3エディション',
        nameEn: 'Nintendo Switch Pro Controller Splatoon 3 Edition',
        franchise: 'Splatoon',
        notes: SAMPLE_NOTE,
      },
      holdings: [
        {
          id: h(),
          quantity: 1,
          costTotalJpy: 8_980,
          acquiredAt: at('2026-06-05'),
          acquiredFrom: 'Bic Camera',
          condition: 'new_unused',
          packagingState: 'sealed_shrink',
        },
      ],
    },
    // Scenario 4: sealed box, opened by the clerk at purchase (packs still sealed)
    {
      product: {
        id: p(),
        type: 'sealed_tcg',
        nameJa: 'ポケモンカードゲーム 30周年記念 BOX',
        nameEn: 'Pokemon TCG 30th Anniversary BOX',
        franchise: 'Pokemon',
        setName: boxSet,
        language: 'JP',
        notes: SAMPLE_NOTE,
      },
      holdings: [
        {
          id: boxHoldingId,
          quantity: 1,
          costTotalJpy: 5_400,
          acquiredAt: at('2026-09-28'),
          acquiredFrom: 'Yodobashi',
          condition: 'new_unused',
          packagingState: 'box_opened_contents_sealed',
          notes: 'Clerk opened the box at the register; packs sealed.',
        },
      ],
    },
    // Scenario 5: pulls from that box
    ...(
      [
        ['ピカチュウ', 'Pikachu', 'SAR', 1],
        ['ミュウ', 'Mew', 'AR', 2],
        ['リザードン', 'Charizard', 'RR', 1],
      ] as const
    ).map(([nameJa, nameEn, rarity, quantity]): SeedItem => ({
      product: {
        id: p(),
        type: 'card_single',
        nameJa,
        nameEn,
        franchise: 'Pokemon',
        setName: boxSet,
        rarity,
        language: 'JP',
        notes: SAMPLE_NOTE,
      },
      holdings: [
        {
          id: h(),
          quantity,
          costTotalJpy: 0,
          acquiredAt: at('2026-09-28'),
          acquiredFrom: 'Yodobashi',
          acquisitionType: 'pull',
          parentHoldingId: boxHoldingId,
          grading: 'raw',
          rawGrade: 'A',
        },
      ],
    })),
  ];

  const productRows = items.map((i) => i.product);
  const holdingRows: NewHolding[] = items.flatMap((i) =>
    i.holdings.map((holding) => ({ ...holding, productId: i.product.id })),
  );

  const eventRows: NewHoldingEvent[] = holdingRows.map((holding) => ({
    id: newId(),
    holdingId: holding.id!,
    type: 'acquired',
    occurredAt: holding.acquiredAt,
    amountJpy: holding.costTotalJpy ?? 0,
    // Snapshot of the state as received; the box's "value as received" bucket comes from here.
    payload: {
      quantity: holding.quantity,
      condition: holding.condition ?? null,
      packagingState: holding.packagingState ?? null,
      grading: holding.grading ?? null,
      rawGrade: holding.rawGrade ?? null,
    },
  }));

  // The box was then opened to pull the cards: record it and mark the box consumed.
  const box = holdingRows.find((r) => r.id === boxHoldingId)!;
  eventRows.push({
    id: newId(),
    holdingId: boxHoldingId,
    type: 'opened',
    occurredAt: '2026-09-28T20:00:00.000+09:00',
    payload: {
      before: { packagingState: box.packagingState },
      after: { packagingState: 'opened' },
    },
  });
  box.packagingState = 'opened';
  box.status = 'consumed';

  // Parents must be inserted before children (self-referencing FK).
  holdingRows.sort(
    (a, b) => Number(Boolean(a.parentHoldingId)) - Number(Boolean(b.parentHoldingId)),
  );

  return { products: productRows, holdings: holdingRows, holdingEvents: eventRows };
}

export async function seed(db: Db) {
  const rows = buildSeed();
  await db.transaction(async (tx) => {
    await tx.insert(products).values(rows.products);
    await tx.insert(holdings).values(rows.holdings);
    await tx.insert(holdingEvents).values(rows.holdingEvents);
  });
  return rows;
}
