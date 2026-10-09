// Sample data covering requirement scenarios 1-5 for a demo account. Local DB only.
import { encryptSecret, generateBackupCodes, hashPassword } from '@tora/auth';
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { addPull, createHolding, markOpened } from './mutations';
import { tcgSets } from './schema';
import { createUser } from './users';

export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'local-dev-password';
/** Fixed, well-known TOTP secret so the demo account can be used in tests. Never use for real. */
export const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const SAMPLE_NOTE = 'Sample seed data. Edit or delete.';
const at = (date: string) => `${date}T12:00:00.000+09:00`;

export async function seedDemoUser(db: Db, authSecret: string) {
  const backup = generateBackupCodes();
  const { user } = await createUser(
    db,
    DEMO_USERNAME,
    {
      passwordHash: await hashPassword(DEMO_PASSWORD),
      totpSecretEnc: encryptSecret(DEMO_TOTP_SECRET, authSecret),
      backupCodeHashes: backup.hashes,
    },
    'admin',
  );
  return { user, backupCodes: backup.codes };
}

export async function seedCollection(db: Db, userId: string) {
  const item = (
    kind: 'collectors_edition' | 'amiibo' | 'controller',
    name: string,
    extra: { franchise?: string; platform?: string; region?: 'jp' } = {},
  ) => ({
    product: {
      category: 'game' as const,
      kind,
      name,
      region: 'jp' as const,
      notes: SAMPLE_NOTE,
      ...extra,
    },
  });

  // Scenario 1-3: game items.
  await createHolding(
    db,
    userId,
    item('collectors_edition', "Fire Emblem: Fortune's Weave Collector's Edition", {
      franchise: 'Fire Emblem',
      platform: 'Nintendo Switch 2',
    }),
    {
      quantity: 1,
      costTotalJpy: 19_800,
      acquiredAt: at('2026-09-20'),
      acquiredFrom: 'My Nintendo Store',
      condition: 'new_unused',
      packagingState: 'sealed_shrink',
    },
  );
  await createHolding(
    db,
    userId,
    item('amiibo', 'amiibo リンク【ティアーズ オブ ザ キングダム】', {
      franchise: 'The Legend of Zelda',
    }),
    {
      quantity: 3,
      costTotalJpy: 9_900,
      acquiredAt: at('2026-08-01'),
      acquiredFrom: 'Yodobashi',
      condition: 'new_unused',
      packagingState: 'sealed_no_shrink',
    },
  );
  await createHolding(
    db,
    userId,
    item('controller', 'Nintendo Switch Proコントローラー ゼノブレイド2エディション', {
      franchise: 'Xenoblade',
      platform: 'Nintendo Switch',
    }),
    {
      quantity: 1,
      costTotalJpy: 12_000,
      acquiredAt: at('2026-07-10'),
      acquiredFrom: 'Mercari',
      condition: 'no_noticeable_damage',
      packagingState: 'opened',
    },
  );

  // Scenario 4-5: a Pokemon box from the catalog when loaded, else entered manually.
  const [set] = await db.select().from(tcgSets).where(eq(tcgSets.sourceKey, 'ja:SV9'));
  const { holding: box } = await createHolding(
    db,
    userId,
    set
      ? { catalog: { setId: set.id, kind: 'booster_box' } }
      : {
          product: {
            category: 'tcg',
            kind: 'booster_box',
            name: 'バトルパートナーズ BOX',
            franchise: 'pokemon',
            region: 'jp',
            setName: 'バトルパートナーズ',
            setCode: 'SV9',
          },
        },
    {
      quantity: 1,
      costTotalJpy: 5_400,
      acquiredAt: at('2026-09-28'),
      acquiredFrom: 'Yodobashi',
      packagingState: 'box_opened_contents_sealed',
      notes: 'Clerk opened the box at the register; packs sealed.',
    },
  );
  for (const [name, rarity, quantity] of [
    ['ピカチュウ', 'SAR', 1],
    ['ミュウ', 'AR', 2],
    ['リザードン', 'RR', 1],
  ] as const) {
    await addPull(
      db,
      userId,
      box.id,
      { card: { name, rarity } },
      { quantity, rawGrade: 'A', acquiredAt: at('2026-09-28') },
    );
  }
  await markOpened(db, userId, box.id, {
    quantity: 1,
    packagingState: 'opened',
    occurredAt: '2026-09-28T20:00:00.000+09:00',
  });
}
