import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { cleanFilter, groupLabel, loadCards, recordText, signalLabel, typeLabel } from './cards';
import { OpportunityList } from './opportunity-list';

/**
 * Worth a look (S13, redesigned S26): chips per item type and per signal proven in it, then every
 * item of the type best first, those with a proven signal apart, loaded as the list is scrolled.
 */
export default async function WorthALookPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; signal?: string }>;
}) {
  const { db, user } = await authed();
  const filter = cleanFilter(await searchParams);
  const [data, t] = await Promise.all([loadCards(db, user, filter, 0), getTranslations()]);
  if (!data?.type) {
    return (
      <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        {t('opportunities.none')}
      </p>
    );
  }
  const type = data.type;
  const signals = data.summary.signals[type] ?? [];
  const href = (q: { type: string; signals?: string[] }) =>
    `/opportunities?type=${encodeURIComponent(q.type)}${q.signals?.length ? `&signal=${q.signals.join(',')}` : ''}`;
  /** The chosen signals with this one added, or taken out. */
  const toggled = (key: string) =>
    filter.signals.some((k) => k === key)
      ? filter.signals.filter((k) => k !== key)
      : [...filter.signals, key];
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-sm transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
    );
  /** The share higher 90 days later on the group with the most checks. */
  const share = (s: (typeof signals)[number]) => {
    const g = s.groups.toSorted(
      (a, b) => (b.tests.signals[s.key]?.checked ?? 0) - (a.tests.signals[s.key]?.checked ?? 0),
    )[0];
    const r = g?.tests.signals[s.key];
    return r?.checked ? `${Math.round((r.higher / r.checked) * 100)}%` : '';
  };
  const chosen = signals.filter((s) => filter.signals.includes(s.key));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {data.summary.types.map((x) => (
            <Link
              key={x.type}
              href={href({ type: x.type })}
              aria-current={x.type === type ? 'page' : undefined}
              className={chip(x.type === type)}
            >
              {typeLabel(t, x.type)} <span className="tabular-nums opacity-70">{x.proven}</span>
            </Link>
          ))}
        </div>
        {signals.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{t('opportunities.signalsHere')}</span>
            {signals.map((s) => {
              const on = filter.signals.includes(s.key);
              return (
                <Link
                  key={s.key}
                  href={href({ type, signals: toggled(s.key) })}
                  aria-pressed={on}
                  className={cn(
                    chip(on),
                    'py-0.5 text-xs',
                    s.warning && !on && 'text-amber-800 dark:text-amber-300',
                  )}
                >
                  {signalLabel(t, s.key, data.rules)}{' '}
                  <span className="tabular-nums">{share(s)}</span>
                </Link>
              );
            })}
          </div>
        )}
        {chosen.length > 0 && (
          <ul className="max-w-3xl space-y-0.5 text-xs text-muted-foreground">
            {chosen.flatMap((c) =>
              c.groups.map((g) => {
                const sample = data.groupItems[g.group];
                return (
                  <li key={`${c.key}|${g.group}`}>
                    <span className="text-foreground">
                      {signalLabel(t, c.key, data.rules)}
                      {sample && <> · {groupLabel(t, sample)}</>}:{' '}
                    </span>
                    {recordText(t, g.tests, c.key)}
                  </li>
                );
              }),
            )}
          </ul>
        )}
        {data.market.map((m) => (
          <div
            key={m.key}
            className="max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2"
          >
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {t('opportunities.marketTitle', {
                signal: signalLabel(t, m.key, data.rules),
                type: typeLabel(t, type).toLowerCase(),
                on: m.on,
                of: m.of,
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('opportunities.marketNote')} {recordText(t, m.tests, m.key)}
            </p>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          {t('opportunities.updated', { day: data.day })}
        </p>
      </div>
      <OpportunityList
        key={`${type}|${filter.signals.join()}`}
        initial={data.rows}
        total={data.total}
        proven={data.proven}
        picked={data.picked}
        filter={{ type, signals: filter.signals }}
        labels={{
          now: t('opportunities.now'),
          target: t('opportunities.target'),
          good: t('opportunities.goodNow'),
          watch: t('opportunities.watch'),
        }}
      />
    </div>
  );
}
