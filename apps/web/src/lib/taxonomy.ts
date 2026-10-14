import 'server-only';
import { type Taxonomy, resolveTaxonomy } from '@tora/core';
import { getRegistry } from './sources';

/** The admin's categories, kinds and condition lists (S16), read once per request. */
export const getTaxonomy = async (): Promise<Taxonomy> =>
  (await getRegistry()).taxonomy ?? resolveTaxonomy(null);
