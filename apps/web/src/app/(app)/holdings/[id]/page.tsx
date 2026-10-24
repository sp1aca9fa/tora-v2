import { deriveBucket, holdingFieldsFor, pendingGrading, productClass, unitCost } from '@tora/core';
import { canEditProduct, estimatedPullCosts, getHoldingDetail, productLots } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { bucketLabel, customFieldLines, productMeta } from '@/lib/product-display';
import { BoxCard } from './box-card';
import { EventList } from './event-list';
import { TrackingForm } from './tracking-form';
import { ValuationCard } from './valuation-card';
import { getMoney } from '@/lib/money-server';
import { getTaxonomy } from '@/lib/taxonomy';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { db, user } = await authed();
  const detail = await getHoldingDetail(db, user.id, (await params).id);
  return detail ? { title: detail.product.name } : {};
}

export default async function HoldingPage({ params }: Params) {
  const money = await getMoney();
  const { id } = await params;
  const { db, user } = await authed();
  const detail = await getHoldingDetail(db, user.id, id);
  if (!detail) notFound();
  const { holding, product, events, parent } = detail;
  const [t, format, pullCosts, itemLots] = await Promise.all([
    getTranslations(),
    getFormatter(),
    holding.parentHoldingId
      ? estimatedPullCosts(db, user.id, holding.parentHoldingId)
      : Promise.resolve(null),
    productLots(db, user.id, product.id),
  ]);
  const estimatedCost = pullCosts?.get(holding.id) ?? null;

  const owned = holding.status === 'owned';
  const cls = productClass(product);
  const fields = holdingFieldsFor(cls);
  const atGrader = pendingGrading(events);
  const bucket = deriveBucket({ productClass: cls, ...holding });
  const isBox = cls === 'sealed';

  const actions = [
    { key: 'edit', show: true },
    { key: 'split', show: owned && holding.quantity > 1 },
    {
      key: 'open',
      show:
        owned && fields.packaging && !['opened', 'empty'].includes(holding.packagingState ?? ''),
    },
    { key: 'grade-submit', show: owned && fields.grading && !atGrader },
    { key: 'grade-return', show: owned && Boolean(atGrader) },
    { key: 'sell', show: owned },
    { key: 'condition', show: owned },
    { key: 'note', show: true },
  ].filter((a) => a.show);

  const facts: [string, React.ReactNode][] = [
    [t('fields.quantity'), holding.quantity],
    [
      t('holding.costBasis'),
      <>
        {money(holding.costTotalBase)}
        {holding.quantity > 1 && (
          <span className="text-muted-foreground">
            {' '}
            (
            {t('common.perUnit', {
              amount: money(unitCost(holding.costTotalBase, holding.quantity)),
            })}
            )
          </span>
        )}
      </>,
    ],
    ...(estimatedCost !== null
      ? [
          [
            t('holding.estimatedCost'),
            <span key="est" className="text-muted-foreground">
              {money(estimatedCost)} ({t('holding.referenceOnly')})
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
    [
      t('fields.acquiredAt'),
      format.dateTime(new Date(holding.acquiredAt), { dateStyle: 'medium' }),
    ],
    [t('fields.acquiredFrom'), holding.acquiredFrom ?? '-'],
    ...(holding.orderId
      ? [[t('fields.orderId'), holding.orderId] as [string, React.ReactNode]]
      : []),
    [t('fields.acquisitionType'), t(`acquisitionType.${holding.acquisitionType}`)],
  ];
  // The admin's own condition list (S16): its name and the value's (see taxonomy-messages).
  if (fields.value && holding.conditionValue)
    facts.push([
      t.has(`conditionLists.${fields.value}`)
        ? t(`conditionLists.${fields.value}`)
        : t('fields.condition'),
      t(`conditionValue.${fields.value}.${holding.conditionValue}`),
    ]);
  if (fields.condition && holding.condition)
    facts.push([t('fields.condition'), t(`condition.${holding.condition}`)]);
  if (fields.packaging && holding.packagingState)
    facts.push([t('fields.packagingState'), t(`packaging.${holding.packagingState}`)]);
  if (fields.grading) {
    facts.push([
      t('fields.grading'),
      holding.grading === 'graded'
        ? `${holding.grader} ${holding.grade}`
        : `Raw ${holding.rawGrade ?? '-'}`,
    ]);
    if (holding.certNumber) facts.push([t('fields.certNumber'), holding.certNumber]);
  }
  if (bucket) facts.push([t('holding.bucket'), bucketLabel(bucket, t)]);

  return (
    // Wide screens: the lot and what to do with it on the left, its value and history on the right.
    <div className="space-y-5 lg:grid lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-5">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">
            <Link href="/" className="hover:underline">
              {t('nav.portfolio')}
            </Link>
            {' › '}
            <Link href={`/products/${product.id}`} className="hover:underline">
              {t('holding.allLots')}
            </Link>
          </p>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">{product.name}</h1>
          {product.nameAlias && product.nameAlias !== product.name && (
            <p className="text-sm">{product.nameAlias}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {productMeta(product, t)}
            {customFieldLines(product, await getTaxonomy(), await getLocale(), t)
              .map((l) => ` · ${l.label}: ${l.value}`)
              .join('')}
            {product.releaseDate && ` · ${t('add.released', { date: product.releaseDate })}`}
            {canEditProduct(user, product) && (
              <>
                {' · '}
                <Link
                  href={`/products/${product.id}/edit?from=/holdings/${holding.id}`}
                  className="underline"
                >
                  {t('holding.editProduct')}
                </Link>
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-1">
              {t(`status.${holding.status}`)}
            </span>
            {atGrader && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-700 dark:text-amber-400">
                {t('holding.atGrader', {
                  grader: atGrader.grader ?? '-',
                  date: format.dateTime(new Date(atGrader.since), { dateStyle: 'medium' }),
                })}
              </span>
            )}
          </div>
        </header>

        {parent && (
          <Link
            href={`/holdings/${parent.holding.id}`}
            className="flex items-center justify-between rounded-md border px-3 py-2.5 text-sm hover:bg-accent"
          >
            <span>{t('portfolio.pulledFrom', { name: parent.product.name })}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        )}

        <Card>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere] sm:text-left">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            {estimatedCost !== null && parent && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('holding.estimatedCostNote', {
                  name: parent.product.name,
                  count: pullCosts?.size ?? 0,
                })}
              </p>
            )}
            {holding.notes && <p className="mt-4 text-sm whitespace-pre-line">{holding.notes}</p>}
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {actions.map((a) => (
            <Button key={a.key} asChild variant="outline" size="sm">
              <Link href={`/holdings/${holding.id}/${a.key}`}>{t(`holding.actions.${a.key}`)}</Link>
            </Button>
          ))}
          <Button asChild variant="outline" size="sm">
            <Link href={`/add?product=${product.id}`}>{t('holding.addMore')}</Link>
          </Button>
        </div>
        <TrackingForm
          holdingId={holding.id}
          countInCost={holding.countInCost}
          countInValue={holding.countInValue}
          otherLots={itemLots.filter((l) => l.id !== holding.id).length}
        />
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2">
          {holding.orderId && (
            <Link
              href={`/holdings/${holding.id}/cancel-order`}
              className="text-sm text-destructive hover:underline"
            >
              {t('holding.actions.cancel-order')}
            </Link>
          )}
          <Link
            href={`/holdings/${holding.id}/delete`}
            className="text-sm text-destructive hover:underline"
          >
            {t('holding.actions.delete')}
          </Link>
        </div>
      </div>
      <div className="space-y-5">
        {/* Current value only for what is still owned; an opened box is valued "as received" below. */}
        {holding.status === 'owned' && (
          <ValuationCard
            db={db}
            userId={user.id}
            holding={holding}
            product={product}
            bucket={bucket}
          />
        )}
        {isBox && <BoxCard db={db} userId={user.id} holdingId={holding.id} />}
        <Link
          href={`/products/${product.id}/details#sources`}
          className="flex items-center justify-between rounded-md border px-3 py-2.5 text-sm hover:bg-accent"
        >
          <span>{t('holding.marketData')}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
        <section className="space-y-3">
          <h2 className="font-semibold">{t('holding.history')}</h2>
          <EventList events={events} />
        </section>
      </div>
    </div>
  );
}
