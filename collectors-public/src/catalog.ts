import type { SetCatalog } from '@tora/collector-sdk';
import { loadCatalogFiles } from '@tora/db';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * TCG set lists (Pokemon in Japanese and English, One Piece, Yu-Gi-Oh! OCG, Magic) from official
 * lists, TCGdex, Yugipedia and Scryfall, kept as files (`pnpm catalog:fetch` refreshes them).
 * Only the regions the admin's set categories list are loaded.
 */
export const tcgSets: SetCatalog = {
  key: 'tcg-sets',
  label: 'TCG sets',
  sets: () =>
    loadCatalogFiles(join(dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'data')),
};
