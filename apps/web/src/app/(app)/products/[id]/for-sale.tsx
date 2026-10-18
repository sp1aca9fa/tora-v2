import type { Supply } from '@tora/db';
import { listingsIn, lowestAsk } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMoney } from '@/lib/money-server';
import { sourceLabels } from '@/lib/sources';

type Raw = { more?: boolean; lotSize?: number; lotSuspect?: number } | null;

/**
 * What is for sale now (S9 part 2): per condition, the lowest ask over the sources and how many
 * listings, read with the nightly collect. Asks, never sales. The item's main condition first,
 * against the buy zone when one is given (S22).
 */
export async function ForSale({
  rows,
  mainBucket,
  zoneTop = null,
}: {
  rows: Supply[];
  mainBucket: string | null;
  /** The buy zone's top in the main condition. */
  zoneTop?: number | null;
}) {
  const [t, format, money, sourceLabel] = await Promise.all([
    getTranslations('forSale'),
    getFormatter(),
    getMoney(),
    sourceLabels(),
  ]);
  const buckets = [...new Set(rows.map((r) => r.bucket))].sort(
    (a, b) => Number(b === mainBucket) - Number(a === mainBucket) || a.localeCompare(b),
  );
  const day = rows
    .map((r) => r.day)
    .sort()
    .at(-1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {day
            ? t('info', {
                date: format.dateTime(new Date(`${day}T12:00:00`), { dateStyle: 'medium' }),
              })
            : t('none')}
        </CardDescription>
      </CardHeader>
      {buckets.length > 0 && (
        <CardContent>
          <ul className="divide-y rounded-md border">
            {buckets.map((bucket) => {
              const best = lowestAsk(rows, bucket);
              const count = listingsIn(rows, bucket);
              const more = rows.some((r) => r.bucket === bucket && (r.raw as Raw)?.more);
              const sources = rows.filter((r) => r.bucket === bucket);
              return (
                <li key={bucket} className="space-y-1 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-mono text-xs">
                      {bucket || t('anyCondition')}
                      {bucket === mainBucket && ` · ${t('yours')}`}
                    </span>
                    <span className="text-right">
                      {best ? (
                        <span className="font-medium tabular-nums">
                          {t('lowest', { amount: money(best.lowestAskBase!) })}
                          {bucket === mainBucket &&
                            zoneTop !== null &&
                            (best.lowestAskBase! <= zoneTop ? (
                              <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                                {t('inZone')}
                              </span>
                            ) : (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {t('aboveZone', {
                                  pct: Math.round((best.lowestAskBase! / zoneTop - 1) * 100),
                                })}
                              </span>
                            ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('nothing')}</span>
                      )}
                      {count !== null && count > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t(more ? 'listingsMore' : 'listings', { count })}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {sources.map((r) => {
                      const raw = r.raw as Raw;
                      const text =
                        r.lowestAskBase !== null ? (
                          <>
                            {sourceLabel(r.source)}{' '}
                            <span className="tabular-nums">{money(r.lowestAskBase)}</span>
                            {raw?.lotSize &&
                              raw.lotSize > 1 &&
                              ` ${t('lot', { count: raw.lotSize })}`}
                          </>
                        ) : (
                          `${sourceLabel(r.source)}: ${t(raw?.lotSuspect ? 'lotOnly' : 'nothingShort')}`
                        );
                      return r.url ? (
                        <a
                          key={r.id}
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                        >
                          {text}
                        </a>
                      ) : (
                        <span key={r.id}>{text}</span>
                      );
                    })}
                  </p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
