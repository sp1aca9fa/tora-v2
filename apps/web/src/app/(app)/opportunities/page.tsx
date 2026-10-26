import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { cleanFilter, groupLabel, loadCards, recordText, typeLabel } from './cards';
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
  const href = (q: { type: string; signal?: string | null }) =>
    `/opportunities?type=${encodeURIComponent(q.type)}${q.signal ? `&signal=${q.signal}` : ''}`;
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
  const chosen = signals.find((s) => s.key === filter.signal);

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
            {signals.map((s) => (
              <Link
                key={s.key}
                href={href({ type, signal: s.key === filter.signal ? null : s.key })}
                aria-current={s.key === filter.signal ? 'true' : undefined}
                className={cn(chip(s.key === filter.signal), 'py-0.5 text-xs')}
              >
                {t(`opportunities.signal.${s.key}`)}{' '}
                <span className="tabular-nums">{share(s)}</span>
              </Link>
            ))}
          </div>
        )}
        {chosen && (
          <ul className="max-w-3xl space-y-0.5 text-xs text-muted-foreground">
            {chosen.groups.map((g) => {
              const sample = data.groupItems[g.group];
              return (
                <li key={g.group}>
                  {sample && <span className="text-foreground">{groupLabel(t, sample)}: </span>}
                  {recordText(t, g.tests, chosen.key)}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {t('opportunities.updated', { day: data.day })}
        </p>
      </div>
      <OpportunityList
        key={`${type}|${filter.signal ?? ''}`}
        initial={data.rows}
        total={data.total}
        proven={data.proven}
        filter={{ type, signal: filter.signal }}
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
