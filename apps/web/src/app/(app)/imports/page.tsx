import { type PurchaseLink, importAttention, importRunsOf, purchaseLinksOf } from '@tora/db';
import { ChevronRight, RotateCw, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { sourceLabel } from '@/lib/product-display';
import { removeLinkAction, retryLinkAction } from './actions';
import { LinksForm } from './links-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('imports') };
}

/** Imports hub (requirements S5d): what needs you, ways to import, and what each import did. */
export default async function ImportsPage() {
  const { db, user } = await authed();
  const [attention, links, runs, t, format] = await Promise.all([
    importAttention(db, user.id),
    purchaseLinksOf(db, user.id, 200),
    importRunsOf(db, user.id),
    getTranslations(),
    getFormatter(),
  ]);
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const failed = links.filter((l) => l.status === 'failed');
  const others = links.filter((l) => l.status !== 'failed');
  const lastEmail = runs.find((r) => r.method === 'email');
  const lastAi = runs.find((r) => r.method === 'claude');
  const countsText = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([k, n]) =>
        t.has(`imports.hub.count.${k}`) ? t(`imports.hub.count.${k}`, { count: n }) : `${k} ${n}`,
      )
      .join(', ');

  const linkRow = (l: PurchaseLink) => (
    <li key={l.id} className="flex items-start gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <a
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-muted-foreground hover:text-foreground"
        >
          {l.url.replace(/^https?:\/\//, '')}
        </a>
        <p className="text-xs">
          <span className={l.status === 'failed' ? 'text-destructive' : 'font-medium'}>
            {t(`imports.links.status.${l.status}`)}
          </span>
          {l.message && <span className="text-muted-foreground"> · {l.message}</span>}
          {l.holdingId && (
            <>
              {' · '}
              <Link href={`/holdings/${l.holdingId}`} className="underline">
                {t('imports.links.open')}
              </Link>
            </>
          )}
        </p>
        {l.status === 'failed' && (
          <Link href={`/add?link=${l.id}`} className="inline-block text-xs font-medium underline">
            {t('imports.links.addByHand')}
          </Link>
        )}
      </div>
      {l.status === 'failed' && (
        <form action={retryLinkAction.bind(null, l.id)}>
          <Button type="submit" variant="ghost" size="icon" aria-label={t('imports.links.retry')}>
            <RotateCw className="size-4" />
          </Button>
        </form>
      )}
      {l.status !== 'imported' && l.status !== 'matched' && (
        <form action={removeLinkAction.bind(null, l.id)}>
          <Button type="submit" variant="ghost" size="icon" aria-label={t('imports.links.remove')}>
            <X className="size-4" />
          </Button>
        </form>
      )}
    </li>
  );

  const tile = (href: string, text: string) => (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
    >
      <span>{text}</span>
      <ChevronRight className="size-4" />
    </Link>
  );

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.imports')}</h1>
        <p className="text-sm text-muted-foreground">{t('imports.hub.intro')}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t('imports.hub.attention')}</h2>
        {attention.total === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('imports.hub.allClear')}
          </p>
        ) : (
          <div className="space-y-2">
            {attention.toReview > 0 &&
              tile('/imports/review', t('imports.banner', { count: attention.toReview }))}
            {attention.ungradedCards > 0 &&
              tile('/holdings/grades', t('grades.banner', { count: attention.ungradedCards }))}
            {attention.suggestions > 0 &&
              tile(
                '/imports/suggestions',
                t('suggestions.banner', { count: attention.suggestions }),
              )}
          </div>
        )}
        {failed.length > 0 && (
          <div id="failed" className="scroll-mt-20 space-y-2">
            <h3 className="font-medium">
              {t('imports.links.failedTitle', { count: failed.length })}
            </h3>
            <p className="text-sm text-muted-foreground">{t('imports.links.failedIntro')}</p>
            <ul className="divide-y rounded-xl border bg-card text-sm">{failed.map(linkRow)}</ul>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{t('imports.hub.start')}</h2>

        <div id="links" className="scroll-mt-20 space-y-2 rounded-xl border bg-card px-4 py-3">
          <h3 className="font-medium">{t('imports.links.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('imports.links.intro')}</p>
          <LinksForm />
          {others.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t('imports.links.pasted', {
                  count: others.length,
                  pending: others.filter((l) => l.status === 'pending').length,
                })}
              </summary>
              <ul className="mt-2 divide-y rounded-lg border">{others.map(linkRow)}</ul>
            </details>
          )}
        </div>

        <div className="space-y-2 rounded-xl border bg-card px-4 py-3">
          <h3 className="font-medium">{t('imports.hub.emailTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('imports.hub.emailIntro')}</p>
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
            pnpm purchases &lt;export.mbox&gt; --user {user.username}
          </pre>
          <p className="text-xs text-muted-foreground">
            {lastEmail
              ? t('imports.hub.emailLast', { date: dateTime(lastEmail.startedAt) })
              : t('imports.hub.emailNever')}
          </p>
        </div>

        <div className="space-y-2 rounded-xl border bg-card px-4 py-3">
          <h3 className="font-medium">{t('imports.hub.aiTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('imports.hub.aiIntro')}</p>
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
            pnpm import-ai &lt;folder&gt; --user {user.username}
          </pre>
          <p className="text-xs text-muted-foreground">
            {lastAi
              ? t('imports.hub.aiLast', { date: dateTime(lastAi.startedAt) })
              : t('imports.hub.aiNever')}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t('imports.hub.history')}</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('imports.hub.noHistory')}</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/imports/runs/${r.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="font-medium">
                      {t(`imports.hub.method.${r.method}`)}
                      {r.source ? ` · ${sourceLabel(r.source)}` : ''}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {dateTime(r.startedAt)}
                      {' · '}
                      {countsText(r.counts) || t('imports.hub.nothing')}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
