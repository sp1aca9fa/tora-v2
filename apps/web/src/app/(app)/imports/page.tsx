import {
  type PurchaseLink,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_FILES,
  actionTotal,
  importRunsOf,
  purchaseLinksOf,
  uploadBatchesOf,
} from '@tora/db';
import { claudeApiAvailable } from '@tora/collector-sdk/uploads';
import { ChevronRight, RotateCw, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { userActions } from '@/lib/actions';
import { sourceLabels } from '@/lib/sources';
import { authed } from '@/lib/auth/guard';
import { removeLinkAction, retryLinkAction } from './actions';
import { LinksForm } from './links-form';
import { UploadForm } from './upload-form';
import { retryUploadsAction } from './upload-actions';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('imports') };
}

/** Imports hub (requirements S5d): what needs you, ways to import, and what each import did. */
/** Reading uploads in the app (Claude API) runs after the answer, within this time. */
export const maxDuration = 300;

export default async function ImportsPage() {
  const sourceLabel = await sourceLabels();
  const { db, user } = await authed();
  const [actions, links, runs, uploads, t, format] = await Promise.all([
    userActions(),
    purchaseLinksOf(db, user.id, 200),
    importRunsOf(db, user.id),
    uploadBatchesOf(db, user.id, 5),
    getTranslations(),
    getFormatter(),
  ]);
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const apiKey = claudeApiAvailable();
  const failed = links.filter((l) => l.status === 'failed');
  // Imports shows its own things; the rest waits on the Actions page.
  const toReview = actionTotal(actions.filter((a) => a.type === 'import_review'));
  const elsewhere = actionTotal(
    actions.filter((a) => a.type !== 'import_review' && a.type !== 'failed_link'),
  );
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
        {toReview === 0 && failed.length === 0 && (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('imports.hub.allClear')}
          </p>
        )}
        {toReview > 0 && tile('/imports/review', t('imports.banner', { count: toReview }))}
        {elsewhere > 0 && (
          <Link
            href="/actions"
            className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm text-muted-foreground hover:bg-accent/50"
          >
            <span>{t('imports.hub.otherActions', { count: elsewhere })}</span>
            <ChevronRight className="size-4" />
          </Link>
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

      {/* Wide screens: ways to import beside the history. */}
      <div className="space-y-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
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

          <div id="upload" className="scroll-mt-20 space-y-2 rounded-xl border bg-card px-4 py-3">
            <h3 className="font-medium">{t('imports.upload.title')}</h3>
            <p className="text-sm text-muted-foreground">
              {apiKey ? t('imports.upload.introApi') : t('imports.upload.introPc')}
            </p>
            <UploadForm maxFiles={UPLOAD_MAX_FILES} maxMb={UPLOAD_MAX_BYTES / 1024 / 1024} />
            {uploads.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm">
                {uploads.map((b) => (
                  <li key={b.batchId} className="flex items-start gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">
                        {t('imports.upload.files', { count: b.files.length })} ·{' '}
                        {dateTime(b.createdAt)}
                      </p>
                      <p
                        className={
                          b.status === 'failed'
                            ? 'text-xs text-destructive'
                            : 'text-xs text-muted-foreground'
                        }
                      >
                        {t(`imports.upload.status.${b.status}`)}
                        {b.message ? ` · ${b.message}` : ''}
                        {b.importRunId && (
                          <>
                            {' · '}
                            <Link href={`/imports/runs/${b.importRunId}`} className="underline">
                              {t('imports.upload.open')}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    {b.status === 'failed' && (
                      <form action={retryUploadsAction.bind(null, b.batchId)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          aria-label={t('imports.links.retry')}
                        >
                          <RotateCw className="size-4" />
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
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
    </div>
  );
}
