// The save path of a daytime job and of a load (requirements S36 A3, B3; plan-deep-read.md step 6
// and 10.1): the nightly's rule marks, then sales stored under another item left where they are.
import { noAiSources } from '@tora/core';
import {
  type Db,
  type JobFindings,
  gameRuleInputs,
  gameRulesOn,
  isHeld,
  loadSourceRegistry,
  refsElsewhere,
} from '@tora/db';
import { markNewSales, marksNewSales } from './game-rules';
import type { baseConverter } from './money';
import { saveObservations } from './save';
import type { Collector, PriceInput } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

type JobItem = {
  id: string;
  category: string;
  kind: string;
  platform: string | null;
  region: string | null;
};

/**
 * A job's rows under its item at the plug-in's marketplace, with the game rules' marks exactly as
 * the nightly sets them (`runCollector`): a judged source (it says how to read a sale and is not
 * noAi), the switch on, the item not held and its stored sales there judged under today's rules
 * (`marksNewSales`); otherwise unmarked, and the closing step judges them. Writes nothing.
 */
export async function judgeJobRows(
  db: Db,
  collector: Collector,
  product: JobItem,
  rows: PriceInput[],
): Promise<PriceInput[]> {
  const source = collector.source;
  const placed = rows.map((r) => ({ ...r, source, productId: product.id }));
  const saleText = collector.saleText?.bind(collector);
  const judged = !!saleText && !noAiSources(await loadSourceRegistry(db)).includes(source);
  if (!judged || !saleText || product.category !== 'game' || !(await gameRulesOn(db)))
    return placed;
  const rules = (await gameRuleInputs(db, [product], source)).get(product.id);
  return rules && !isHeld(rules.state?.held) && marksNewSales(rules.state, source, rules.hash)
    ? markNewSales(placed, rules.rules, source, saleText)
    : placed;
}

/**
 * Saves a job's rows under its item (S36 B3), in this order:
 * - each row goes under `product` at the plug-in's marketplace, its raw stamped `job` (as S30's
 *   `recheck`), so a load's undo finds exactly its rows;
 * - the game rules mark them as the nightly does (`judgeJobRows`);
 * - a sale stored under another item is never moved or copied: left out, and listed when this
 *   item's verdict keeps it (it blocks the span), else only counted (`notItem`);
 * - a sale stored here undone by a load that this item keeps is listed (it blocks the span too).
 * The rest go through `saveObservations` (duplicates do nothing).
 */
export async function saveJobRows(
  db: Db,
  input: {
    collector: Collector;
    jobId: string;
    product: JobItem;
    rows: PriceInput[];
    toBase: Awaited<ReturnType<typeof baseConverter>>;
  },
): Promise<JobFindings> {
  const { collector, jobId, product } = input;
  const stamped = input.rows.map((r) => ({
    ...r,
    raw: { ...(isRecord(r.raw) ? r.raw : {}), job: jobId },
  }));
  const rows = await judgeJobRows(db, collector, product, stamped);
  const stored = await refsElsewhere(
    db,
    collector.source,
    product.id,
    rows.map((r) => r.externalRef),
  );
  const found: JobFindings = { added: 0, elsewhere: new Map(), notItem: 0, undoneHere: [] };
  const kept = rows.filter((r) => {
    const other = stored.elsewhere.get(r.externalRef);
    if (other) {
      if (r.excluded) found.notItem++;
      else found.elsewhere.set(r.externalRef, other);
      return false;
    }
    if (!r.excluded && stored.undone.has(r.externalRef)) found.undoneHere.push(r.externalRef);
    return true;
  });
  found.added = kept.length ? await saveObservations(db, input.toBase, kept) : 0;
  return found;
}
