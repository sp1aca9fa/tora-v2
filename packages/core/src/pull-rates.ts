// Suggested pull rates (S20): community numbers per set, the starting point the admin corrects in
// Settings > Admin > Box opening. They come from plug-ins (`PullRateSource`), saved by the home PC.
import type { PullRates } from './opening';

export interface SuggestedRates extends PullRates {
  franchise: string;
  region: string;
  /** The catalog set's name holds this. */
  name: string;
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/** The suggested rates of a catalog set among those the plug-ins gave, or null. */
export function suggestedRates(
  set: { franchise: string; region: string | null; name: string },
  suggested: SuggestedRates[],
): PullRates | null {
  const name = norm(set.name);
  const found = suggested.find(
    (s) => s.franchise === set.franchise && s.region === set.region && name.includes(norm(s.name)),
  );
  if (!found) return null;
  const { code, packsPerBox, tiers, source } = found;
  return { code, packsPerBox, tiers, source };
}
