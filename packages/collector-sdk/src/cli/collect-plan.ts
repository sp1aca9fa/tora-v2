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

/** What a collect did with one source, for the activity log and the alert after the run. */
export interface SourceResult {
  source: string;
  status: string;
  requests: number;
  observations: number;
}

/**
 * A site refusing Tora outside a collector's run (the owner, 2026-11-07: alerts like a refused
 * collector). In the run's results, so it goes the way a refused collector does: a failed entry in
 * the activity log, sent to admins after the run. Its status has its own text (`status_blocked_*`
 * in the alert texts). The site is left alone for the rest of the day (`blockedOn`), so it comes
 * once a day per site. Requests are not counted: the step's client is shared by its sites.
 */
export const refusedResult = (source: string, step: 'rankings' | 'opening'): SourceResult => ({
  source,
  status: `blocked_${step}`,
  requests: 0,
  observations: 0,
});

/** Whether a collect's activity entry is a failure, which admins are sent. */
export const runFailed = (results: SourceResult[]) =>
  results.some((r) => r.status === 'failed' || r.status.startsWith('blocked'));
