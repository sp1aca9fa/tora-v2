import { FREE_ROWS_READ, FREE_ROWS_WRITTEN, monthUsage } from '@tora/db';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { DbBudgetForm } from '../../db-budget-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.database.title') };
}

/** Days listed under the month's totals. */
const DAYS_SHOWN = 14;

/** The hosted database's month so far (S19): rows read and written against the free plan. */
export default async function DatabaseSettingsPage() {
  const { db } = await adminOnly();
  const [usage, t, format] = await Promise.all([
    monthUsage(db),
    getTranslations('database'),
    getFormatter(),
  ]);
  const rows = (n: number) => format.number(n, { notation: 'compact', maximumFractionDigits: 1 });
  const over = usage.projectedRead > usage.budget || usage.read > usage.budget;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1 rounded-md bg-muted px-3 py-2.5">
          <p className={over ? 'font-medium text-destructive' : 'font-medium'}>
            {t('read', {
              month: usage.month,
              read: rows(usage.read),
              free: rows(FREE_ROWS_READ),
              projected: rows(usage.projectedRead),
            })}
          </p>
          <p>{t('written', { written: rows(usage.written), free: rows(FREE_ROWS_WRITTEN) })}</p>
          <DbBudgetForm millions={Math.round(usage.budget / 1e6)} />
          <p className="text-xs text-muted-foreground">{t('budgetInfo')}</p>
        </div>
        {usage.byOrigin.length === 0 ? (
          <p className="text-muted-foreground">{t('none')}</p>
        ) : (
          <>
            <div className="space-y-1">
              <p className="font-medium">{t('byOrigin')}</p>
              {usage.byOrigin.map((o) => (
                <p key={o.origin} className="flex justify-between gap-3">
                  <span>{t.has(`origin.${o.origin}`) ? t(`origin.${o.origin}`) : o.origin}</span>
                  <span className="tabular-nums">
                    {t('readWritten', { read: rows(o.read), written: rows(o.written) })}
                  </span>
                </p>
              ))}
            </div>
            <div className="space-y-1">
              <p className="font-medium">{t('byDay')}</p>
              {usage.days.slice(0, DAYS_SHOWN).map((d) => (
                <p key={d.day} className="flex justify-between gap-3">
                  <span>{d.day}</span>
                  <span className="tabular-nums">
                    {t('readWritten', { read: rows(d.read), written: rows(d.written) })}
                  </span>
                </p>
              ))}
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
