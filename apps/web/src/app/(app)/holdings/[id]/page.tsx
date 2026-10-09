import { deriveBucket, holdingFieldsFor, pendingGrading, productClass, unitCost } from '@tora/core';
import { canEditProduct, getHoldingDetail } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { productMeta } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { EventList } from './event-list';
import { PriceSources } from './price-sources';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { db, user } = await authed();
  const detail = await getHoldingDetail(db, user.id, (await params).id);
  return detail ? { title: detail.product.name } : {};
}

export default async function HoldingPage({ params }: Params) {
  const { id } = await params;
  const { db, user } = await authed();
  const detail = await getHoldingDetail(db, user.id, id);
  if (!detail) notFound();
  const { holding, product, events, children, parent } = detail;
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

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
        {formatJpy(holding.costTotalJpy)}
        {holding.quantity > 1 && (
          <span className="text-muted-foreground">
            {' '}
            (
            {t('common.perUnit', {
              amount: formatJpy(unitCost(holding.costTotalJpy, holding.quantity)),
            })}
            )
          </span>
        )}
      </>,
    ],
    [
      t('fields.acquiredAt'),
      format.dateTime(new Date(holding.acquiredAt), { dateStyle: 'medium' }),
    ],
    [t('fields.acquiredFrom'), holding.acquiredFrom ?? '-'],
    [t('fields.acquisitionType'), t(`acquisitionType.${holding.acquisitionType}`)],
  ];
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
  if (bucket)
    facts.push([
      t('holding.bucket'),
      <code key="b" className="text-xs">
        {bucket}
      </code>,
    ]);

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/" className="hover:underline">
            {t('nav.portfolio')}
          </Link>
        </p>
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          {productMeta(product, t)}
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
          <span className="rounded-full bg-muted px-2.5 py-1">{t(`status.${holding.status}`)}</span>
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
                <dd className="text-right tabular-nums sm:text-left">{v}</dd>
              </div>
            ))}
          </dl>
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

      {isBox && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('holding.pulls', { count: children.length })}</CardTitle>
            <Button asChild size="sm">
              <Link href={`/holdings/${holding.id}/pulls`}>{t('holding.logPulls')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('holding.noPulls')}</p>
            ) : (
              <ul className="divide-y text-sm">
                {children.map((c) => (
                  <li key={c.holding.id}>
                    <Link
                      href={`/holdings/${c.holding.id}`}
                      className="flex justify-between gap-3 py-2 hover:underline"
                    >
                      <span>
                        {c.product.name}
                        {c.product.rarity && (
                          <span className="text-muted-foreground"> {c.product.rarity}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {c.holding.grading === 'graded'
                          ? `${c.holding.grader} ${c.holding.grade}`
                          : `Raw ${c.holding.rawGrade ?? '-'}`}{' '}
                        × {c.holding.quantity}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <PriceSources db={db} product={product} holdingId={holding.id} bucket={bucket} />

      <section className="space-y-3">
        <h2 className="font-semibold">{t('holding.history')}</h2>
        <EventList events={events} />
      </section>

      <div className="pt-2">
        <Link
          href={`/holdings/${holding.id}/delete`}
          className="text-sm text-destructive hover:underline"
        >
          {t('holding.actions.delete')}
        </Link>
      </div>
    </div>
  );
}
