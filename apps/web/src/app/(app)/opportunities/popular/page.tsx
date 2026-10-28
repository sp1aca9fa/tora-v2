import { type PopularBy, POPULAR_BY } from '@tora/db';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { cleanSearch, typeLabel } from '../cards';
import { PopularList } from '../popular-list';
import { PopularRow } from '../popular-row';
import { loadPopular } from '../popular-rows';

/** Shown at first per site ranking; the rest open on demand. */
const FIRST = 10;

/**
 * Popular (S13 part 3, as a sub page S26; per item type and measure S27): a site's own ranking,
 * or the items Tora follows ranked by trades on every site (30 days, trending, the year), each
 * with Tora's view.
 */
export default async function PopularPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; by?: string; q?: string }>;
}) {
  const { db, user } = await authed();
  const q = await searchParams;
  const asked = (POPULAR_BY as readonly string[]).includes(q.by ?? '')
    ? (q.by as PopularBy)
    : 'site';
  const search = cleanSearch(q.q);
  const [data, t, tAll] = await Promise.all([
    loadPopular(db, user, typeof q.type === 'string' ? q.type : null, asked, 0, search),
    getTranslations('opportunities'),
    getTranslations(),
  ]);
  if (!data.type) {
    return (
      <p className="max-w-3xl rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        {search ? t('search.none', { q: search }) : t('noRankings')}
      </p>
    );
  }
  const type = data.type;
  const href = (q: { type: string; by: PopularBy }) =>
    `/opportunities/popular?type=${encodeURIComponent(q.type)}&by=${q.by}${search ? `&q=${encodeURIComponent(search)}` : ''}`;
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-sm transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
    );
  const labels = { tora: t('toraView'), worth: t('toraWorth') };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {data.types.map((x) => (
            <Link
              key={x}
              href={href({ type: x, by: data.by })}
              aria-current={x === type ? 'page' : undefined}
              className={chip(x === type)}
            >
              {typeLabel(tAll, x)}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('popular.by')}</span>
          {POPULAR_BY.map((b) => (
            <Link
              key={b}
              href={href({ type, by: b })}
              aria-pressed={b === data.by}
              className={cn(
                'rounded-md border px-2.5 py-0.5 text-xs transition-colors',
                b === data.by ? 'border-foreground/40 bg-muted font-medium' : 'hover:bg-accent',
              )}
            >
              {t(`popular.measure.${b}`)}
            </Link>
          ))}
        </div>
        <p className="max-w-3xl text-xs text-muted-foreground">
          {data.fellBack && <>{t('popular.fellBack')} </>}
          {t(`popular.about.${data.by}`, { day: data.day ?? '-' })}
          {search && <> {t('search.ranks')}</>}
        </p>
      </div>
      {data.by === 'site' ? (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          {data.boards.map((b) => (
            <section key={b.ranking} className="space-y-2">
              <div className="space-y-1">
                <h2 className="font-semibold">{b.label}</h2>
                <p className="text-xs text-muted-foreground">{t('popularIntro', { day: b.day })}</p>
              </div>
              <div className="rounded-xl border bg-card p-1">
                <ul className="divide-y">
                  {b.rows.slice(0, FIRST).map((r) => (
                    <PopularRow key={r.key} r={r} labels={labels} />
                  ))}
                </ul>
                {b.rows.length > FIRST && (
                  <details className="group">
                    <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground group-open:hidden hover:text-foreground">
                      {t('showAll', { count: b.rows.length })}
                    </summary>
                    <ul className="divide-y border-t">
                      {b.rows.slice(FIRST).map((r) => (
                        <PopularRow key={r.key} r={r} labels={labels} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : data.total ? (
        <PopularList
          key={`${type}|${data.by}|${search ?? ''}`}
          initial={data.rows}
          total={data.total}
          type={type}
          by={data.by}
          q={search}
        />
      ) : (
        <p className="max-w-3xl rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {search ? t('search.none', { q: search }) : t(`popular.none.${data.by}`)}
        </p>
      )}
    </div>
  );
}
