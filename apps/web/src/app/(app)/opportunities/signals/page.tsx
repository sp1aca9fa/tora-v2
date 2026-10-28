import {
  type OpportunitySignal,
  type OpportunityTests,
  OPPORTUNITY_WARNINGS,
  PROVEN_MIN_CHECKS,
  isBuiltInSignal,
  provenEdge,
} from '@tora/core';
import { type Product, opportunitiesFor, signalPicks } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { groupLabel, signalAnchor, signalLabel, typeLabel } from '../cards';
import { CHIP } from '../opportunity-row';
import { PickSignal } from '../pick-signal';

interface Group {
  group: string;
  tests: OpportunityTests;
  product: Product;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x > 0 ? '+' : ''}${pct(x)}`;
/** A share's gap in percentage points ("+18"). */
const signedPoints = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}`;

/**
 * Signals and their record (S13, as a sub page S26): per item type, each group's signals tested
 * on its past prices against buying on any day.
 */
export default async function SignalsPage() {
  const { db, user } = await authed();
  const [data, t, picks] = await Promise.all([
    opportunitiesFor(db, user.id),
    getTranslations(),
    signalPicks(db),
  ]);
  const items = data?.items ?? [];
  const rules = data?.rules ?? [];
  const admin = user.role === 'admin';
  const types = [...new Set(items.map((o) => o.itemType))];

  /** Each group of a type with its tests. */
  const groups = (type: string) => {
    const out = new Map<string, Group>();
    for (const o of items) {
      if (o.itemType === type && o.tests && !out.has(o.group)) {
        out.set(o.group, { group: o.group, tests: o.tests, product: o.product });
      }
    }
    return [...out.values()].filter((g) => g.tests.any.checked > 0);
  };
  const all = types.flatMap((type) => groups(type));
  // The signals that beat buying on any day by most, for the top of the page.
  const best = all
    .flatMap((g) =>
      (Object.keys(g.tests.signals) as OpportunitySignal[]).flatMap((key) => {
        const edge = provenEdge(g.tests, key, rules);
        const rule = isBuiltInSignal(key) ? null : rules.find((x) => x.key === key);
        const warning = rule
          ? !!rule.warning
          : (OPPORTUNITY_WARNINGS as readonly string[]).includes(key);
        return edge !== null && !warning ? [{ g, key, edge }] : [];
      }),
    )
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 3);
  const higher = (h: number, c: number) => (c ? pct(h / c) : '-');
  const table = ({ group, tests, product }: Group) => {
    const keys = (Object.keys(tests.signals) as OpportunitySignal[]).sort();
    // Groups with a proven signal or warning open; the rest (few checks) folded.
    const open = keys.some((k) => provenEdge(tests, k, rules) !== null);
    return (
      <details key={group} open={open} className="group/g min-w-0 space-y-2">
        <summary className="cursor-pointer text-sm font-medium">
          {groupLabel(t, product)}{' '}
          <span className="font-normal text-muted-foreground">
            {t('opportunities.group', { items: tests.items })}
            {!open && <> · {t('opportunities.fewChecks')}</>}
          </span>
        </summary>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium">{t('opportunities.colSignal')}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('opportunities.colChecked')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{t('opportunities.colHigher')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('opportunities.colVsAny')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('opportunities.colChange')}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums [&_td:not(:first-child)]:whitespace-nowrap">
              <tr className="border-b bg-muted/40">
                <td className="px-3 py-1.5">{t('opportunities.anyDay')}</td>
                <td className="px-3 py-1.5 text-right">{tests.any.checked}</td>
                <td className="px-3 py-1.5 text-right">
                  {higher(tests.any.higher, tests.any.checked)}
                </td>
                <td className="px-3 py-1.5 text-right">-</td>
                <td className="px-3 py-1.5 text-right">
                  {tests.any.change !== null ? signed(tests.any.change) : '-'}
                </td>
              </tr>
              {keys.map((key) => {
                const r = tests.signals[key]!;
                const rule = isBuiltInSignal(key) ? null : rules.find((x) => x.key === key);
                const warning = rule
                  ? !!rule.warning
                  : (OPPORTUNITY_WARNINGS as readonly string[]).includes(key);
                const proven =
                  provenEdge(tests, key, rules) === null ? null : warning ? 'warning' : 'proven';
                const picked = !proven && !!rule && picks.includes(key);
                return (
                  <tr
                    key={key}
                    id={signalAnchor(group, key)}
                    className={cn(
                      'scroll-mt-20 target:bg-amber-500/10',
                      'border-b last:border-0',
                      // Too few checks to read anything into.
                      r.checked < PROVEN_MIN_CHECKS && 'text-muted-foreground',
                    )}
                  >
                    <td className="px-3 py-1.5">
                      {signalLabel(t, key, rules)}
                      {rule && (
                        <span className="ml-1 text-muted-foreground">
                          · {t('opportunities.pluginTag')}
                        </span>
                      )}
                      {picked && (
                        <span className={cn('ml-2 rounded px-1.5 py-0.5', CHIP.pick)}>
                          {t('opportunities.pickTag')}
                        </span>
                      )}
                      {admin && rule && !proven && <PickSignal signal={key} picked={picked} />}
                      {proven && (
                        <span
                          className={cn(
                            'ml-2 rounded px-1.5 py-0.5',
                            CHIP[proven === 'warning' ? 'warning' : 'proven'],
                          )}
                        >
                          {t(`opportunities.${proven}`)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.checked}</td>
                    <td className="px-3 py-1.5 text-right">{higher(r.higher, r.checked)}</td>
                    <td className="px-3 py-1.5 text-right">
                      {r.checked && tests.any.checked
                        ? t('opportunities.points', {
                            n: signedPoints(
                              r.higher / r.checked - tests.any.higher / tests.any.checked,
                            ),
                          })
                        : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {r.change !== null ? signed(r.change) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    );
  };

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-xs text-muted-foreground">{t('opportunities.recordsIntro')}</p>
      {best.length > 0 && (
        <section className="space-y-1.5 rounded-xl border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold">{t('opportunities.bestTitle')}</h2>
          <ul className="space-y-1 text-sm">
            {best.map(({ g, key }) => {
              const r = g.tests.signals[key]!;
              return (
                <li key={`${g.group}|${key}`}>
                  <Link href={`#${signalAnchor(g.group, key)}`} className="hover:underline">
                    <span className="font-medium">{signalLabel(t, key, rules)}</span> ·{' '}
                    {groupLabel(t, g.product)}
                  </Link>
                  <span className="text-muted-foreground">
                    {': '}
                    {t('opportunities.bestLine', {
                      pct: higher(r.higher, r.checked),
                      checked: r.checked,
                      points: signedPoints(
                        r.higher / r.checked - g.tests.any.higher / g.tests.any.checked,
                      ),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {types.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-xs">
          {types.map((type) =>
            groups(type).length ? (
              <a
                key={type}
                href={`#type-${type}`}
                className="rounded-full border px-3 py-1 hover:bg-accent"
              >
                {typeLabel(t, type)}
              </a>
            ) : null,
          )}
        </nav>
      )}
      {types.map((type) => {
        const list = groups(type);
        return list.length ? (
          <section key={type} id={`type-${type}`} className="scroll-mt-20 space-y-3">
            <h2 className="font-semibold">{typeLabel(t, type)}</h2>
            <div className="gap-4 xl:columns-2 min-[1800px]:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {list.map(table)}
            </div>
          </section>
        ) : null;
      })}
    </div>
  );
}
