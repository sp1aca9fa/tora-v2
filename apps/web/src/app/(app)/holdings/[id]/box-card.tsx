import { type Db, boxView } from '@tora/db';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfidenceBadge } from '@/components/valuation-meta';
import { formatJpy } from '@/lib/utils';
import { ManualPriceForm } from './manual-price-form';
import { clearManualPriceAction, setManualPriceAction } from './valuation-actions';

/** Box view (requirements section 6): paid | value as received | pulls value | net. */
export async function BoxCard({
  db,
  userId,
  holdingId,
}: {
  db: Db;
  userId: string;
  holdingId: string;
}) {
  const [t, view] = await Promise.all([getTranslations(), boxView(db, userId, holdingId)]);
  if (!view) return null;
  const cells = [
    { label: t('box.paid'), value: formatJpy(view.paidJpy) },
    {
      label: t('box.asReceived'),
      value: view.asReceived.valueJpy === null ? '-' : formatJpy(view.asReceived.valueJpy),
      hint: view.receivedState ? t(`packaging.${view.receivedState}`) : null,
    },
    {
      label: t('box.pulls'),
      value: formatJpy(view.pullsValueJpy),
      hint: t('box.pullsValued', { valued: view.pullsValued, total: view.pulls.length }),
    },
    {
      label: t('box.net'),
      value: `${view.netJpy > 0 ? '▲ +' : view.netJpy < 0 ? '▼ ' : ''}${formatJpy(view.netJpy)}`,
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('holding.pulls', { count: view.pulls.length })}</CardTitle>
        <Button asChild size="sm">
          <Link href={`/holdings/${holdingId}/pulls`}>{t('holding.logPulls')}</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cells.map((c) => (
            <div key={c.label} className="rounded-md bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{c.label}</dt>
              <dd className="font-medium tabular-nums">{c.value}</dd>
              {c.hint && <dd className="text-xs text-muted-foreground">{c.hint}</dd>}
            </div>
          ))}
        </dl>
        {view.asReceivedBucket && (
          <details className="text-sm" open={view.asReceived.valueJpy === null}>
            <summary className="cursor-pointer text-muted-foreground">
              {t('box.manualTitle')}
            </summary>
            <div className="mt-2 space-y-2">
              {view.asReceived.valueJpy === null && (
                <p className="text-xs text-muted-foreground">{t('box.asReceivedHint')}</p>
              )}
              {view.asReceived.method === 'manual' && (
                <form
                  action={clearManualPriceAction.bind(
                    null,
                    view.box.product.id,
                    holdingId,
                    view.asReceivedBucket,
                  )}
                >
                  <Button variant="ghost" size="sm">
                    {t('valuation.clearManual')}
                  </Button>
                </form>
              )}
              <ManualPriceForm
                action={setManualPriceAction.bind(
                  null,
                  view.box.product.id,
                  holdingId,
                  view.asReceivedBucket,
                )}
              />
            </div>
          </details>
        )}
        {view.pulls.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('holding.noPulls')}</p>
        ) : (
          <ul className="divide-y text-sm">
            {view.pulls.map(({ holding, product, valuation }) => (
              <li key={holding.id}>
                <Link
                  href={`/holdings/${holding.id}`}
                  className="flex justify-between gap-3 py-2 hover:underline"
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {product.name}
                      {product.rarity && (
                        <span className="text-muted-foreground"> {product.rarity}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {holding.grading === 'graded'
                        ? `${holding.grader} ${holding.grade}`
                        : `Raw ${holding.rawGrade ?? '-'}`}{' '}
                      × {holding.quantity}
                      {holding.status !== 'owned' && ` · ${t(`status.${holding.status}`)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums">
                      {valuation.valueJpy === null ? '-' : formatJpy(valuation.valueJpy)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <ConfidenceBadge confidence={valuation.confidence} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
