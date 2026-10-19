import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMoney } from '@/lib/money-server';
import type { BoxOpening } from '@/lib/opening';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** "3 a box", "1 in 6 boxes". */
export function perBoxText(perBox: number, t: T): string {
  if (perBox >= 1) return t('opening.aBox', { n: Math.round(perBox * 10) / 10 });
  if (perBox <= 0) return '-';
  return t('opening.inBoxes', { n: Math.round(1 / perBox) });
}

/** The opening value's key numbers: the verdict at today's price, break-even, the spread. */
export async function OpeningNumbers({
  opening,
  retail,
}: {
  opening: BoxOpening;
  retail: number | null;
}) {
  const [t, money] = await Promise.all([getTranslations('opening'), getMoney()]);
  const { value, boxPrice } = opening;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const numbers: [string, string][] = [
    [t('boxPrice'), boxPrice === null ? '-' : money(boxPrice)],
    [t('breakEven'), money(Math.round(value.expected))],
    [t('back'), boxPrice ? percent(value.expected / boxPrice) : '-'],
    [t('chanceBack'), value.chanceBack === null ? '-' : percent(value.chanceBack)],
    [t('median'), money(Math.round(value.median))],
    [
      t('premium'),
      boxPrice && value.expected > 0 ? `×${(boxPrice / value.expected).toFixed(1)}` : '-',
    ],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {boxPrice === null
            ? t('verdictNoPrice', { breakEven: money(Math.round(value.expected)) })
            : t(value.expected >= boxPrice ? 'verdictPays' : 'verdictLoses', {
                breakEven: money(Math.round(value.expected)),
              })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {numbers.map(([label, v]) => (
            <div key={label} className="rounded-xl border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          {t('spread', { low: money(Math.round(value.low)), high: money(Math.round(value.high)) })}
          {retail
            ? ` ${t('atRetail', { retail: money(retail), back: percent(value.expected / retail) })}`
            : ''}
        </p>
        <p className="text-xs text-muted-foreground">{t('notAdvice')}</p>
      </CardContent>
    </Card>
  );
}
