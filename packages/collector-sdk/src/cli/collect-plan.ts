// What a collect leaves out before it starts (the parts of `pnpm collect` that can be tested).
import {
  type ProductClass,
  type SourceRegistry,
  identitySources,
  roleOf,
  sourceInfo,
  typesOf,
} from '@tora/core';

/**
 * Whether a source's data is used nowhere: its role is `off` for every item type (Settings >
 * Admin > Sources) and it is no type's identity source in its market. Its collector, rankings and
 * set cards are then not collected (requirements S8: roles say what a source is used for). A
 * source the registry does not describe is kept: unknown is not off.
 */
export function offEverywhere(registry: SourceRegistry, key: string): boolean {
  const info = sourceInfo(registry, key);
  if (!info) return false;
  // Every type of the admin's categories, and any other type the source has a role for.
  const classes = new Set<ProductClass>([
    ...typesOf(registry),
    ...Object.keys(registry.roles[key] ?? {}),
  ]);
  for (const cls of classes) {
    if (roleOf(registry, key, cls) !== 'off') return false;
    // null, not undefined: the source's own market (undefined would mean the primary one).
    if (identitySources(registry, cls, info.market ?? null).includes(key)) return false;
  }
  return true;
}
