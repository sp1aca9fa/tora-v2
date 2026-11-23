import {
  type CheckListing,
  type CheckSale,
  type DropReason,
  nextWishToCheck,
  ownWish,
  registrationCheck,
} from '@tora/db';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';
import {
  confirmListingsAction,
  confirmSalesAction,
  markListingAction,
  markSaleAction,
  releaseAction,
  turnOnRulesAction,
  unmarkSaleAction,
} from '../../wish-actions';
import { DroppedRows, OpenOnWide, SampleRows } from './expanders';
import { RulesForm } from './rules-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('wish.check'))('title') };
}

/**
 * The registration check of a wish (requirements S36 B1): the item's rules, then per source what
 * Tora kept and dropped, sales and listings side by side on a wide screen. The person's own wish
 * only (another person's wish id is not found); each action is checked again on the server.
 */
export default async function WishCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, user } = await authed();
  const { id } = await params;
  const wish = await ownWish(db, user.id, id);
  if (!wish) notFound();
  const [c, t, money, sourceLabel, format] = await Promise.all([
    registrationCheck(db, wish),
    getTranslations('wish.check'),
    getMoney(),
    sourceLabels(),
    getFormatter(),
  ]);
  // Cards and sealed have no check (S36 Scope rule): their wishes are as before.
  if (!c.game && !c.kindOff) notFound();
  const isAdmin = user.role === 'admin';
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const salesKept = c.sales.reduce((n, s) => n + s.kept, 0);
  const salesDropped = c.sales.reduce((n, s) => n + s.dropped, 0);
  const salesWould = c.sales.reduce((n, s) => n + s.would, 0);
  // Tags and their tooltip only when the sample is a part of what was kept (fix U2).
  const sampled = c.sales.some((s) => s.kept > s.sample.length);
  // After this game's sales are confirmed: the person's next game waiting for its check.
  const next = c.salesConfirmed ? await nextWishToCheck(db, user.id, c.watch.id) : null;
  // Counts: "would be dropped" while the rules drop nothing yet (fix U4).
  const counts = (kept: number, dropped: number, would: number, keptKey: string) =>
    [
      t(keptKey, { count: kept }),
      dropped > 0 && t('droppedCount', { count: dropped }),
      would > 0 && t('wouldCount', { count: would }),
    ]
      .filter(Boolean)
      .join(', ');
  const droppedLabel = (dropped: number, would: number) =>
    [
      dropped > 0 && t('dropped', { count: dropped }),
      would > 0 && t('wouldDropped', { count: would }),
    ]
      .filter(Boolean)
      .join(' · ');
  const awaiting = (
    <p className="text-xs text-muted-foreground">
      {t('awaitsRead')}{' '}
      {c.nextCollect ? t('nextRead', { when: when(c.nextCollect) }) : t('noNextRead')}
    </p>
  );

  const notice = (
    text: React.ReactNode,
    tone: 'info' | 'warn' = 'info',
    action?: React.ReactNode,
  ) => (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
        tone === 'warn' ? 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/40' : 'bg-card',
      )}
    >
      <p className="max-w-3xl">{text}</p>
      {action}
    </div>
  );

  // A sale dropped by hand can be taken back (fix 3): a plain wish's by its owner (the page is the
  // owner's), a boxed wish's own mark by its maker or an admin; the server checks again.
  const mayUndo = (s: CheckSale, reason?: DropReason) =>
    reason === 'manual' &&
    c.game &&
    (!s.byCheck || isAdmin) &&
    (!c.rowsOf || (s.markedBy !== undefined && (isAdmin || s.markedBy === user.id)));

  const saleLine = (source: string, s: CheckSale, reason?: DropReason) => (
    <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5">
      <span className={cn('min-w-0', reason && 'text-muted-foreground')}>
        <Title
          title={s.title}
          url={s.url}
          fallback={t('untitled', { source: sourceLabel(source) })}
        />
        <span className="block text-[11px] text-muted-foreground">
          {date(s.observedAt)}
          {reason
            ? ` · ${t(`reason.${reason}`)}`
            : sampled && s.sets.length > 0 && ` · ${s.sets.map((set) => t(set)).join(', ')}`}
        </span>
      </span>
      <span className="text-right tabular-nums">{money(s.priceBase)}</span>
      <span className="flex justify-end">
        {!reason && c.game && (
          <form action={markSaleAction.bind(null, c.watch.id, s.id)}>
            <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs">
              {t('notItem')}
            </Button>
          </form>
        )}
        {mayUndo(s, reason) && (
          <form action={unmarkSaleAction.bind(null, c.watch.id, s.id)}>
            <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
              {t('undoNotItem')}
            </Button>
          </form>
        )}
      </span>
    </li>
  );

  const listingLine = (source: string, o: CheckListing, dropped: boolean) => (
    <li
      key={`${source}|${o.ref}`}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5"
    >
      <span className={cn('min-w-0', dropped && 'text-muted-foreground')}>
        <Title
          title={o.title}
          url={o.url}
          fallback={t('untitled', { source: sourceLabel(source) })}
        />
        {o.reason && (
          <span className="block text-[11px] text-muted-foreground">{t(`reason.${o.reason}`)}</span>
        )}
      </span>
      <span className="text-right tabular-nums">{money(o.priceBase)}</span>
      <span className="flex justify-end">
        {!dropped && c.game && (
          <form action={markListingAction.bind(null, c.watch.id, source, o.ref)}>
            <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs">
              {t('notItem')}
            </Button>
          </form>
        )}
      </span>
    </li>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <Link
          href="/watchlist"
          className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{c.product.name}</h1>
        <p className="max-w-3xl text-sm">{t('instruction')}</p>
        {next && (
          <p className="text-sm">
            <Link
              href={`/watchlist/${next.wishId}/check`}
              className="inline-flex min-h-9 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('nextGame', { name: next.name })} <ArrowRight className="size-4" />
            </Link>
          </p>
        )}
      </header>

      <div className="space-y-2">
        {!c.firstRead &&
          notice(
            <>
              {t('notRead')}{' '}
              {c.nextCollect ? t('nextRead', { when: when(c.nextCollect) }) : t('noNextRead')}
            </>,
          )}
        {c.rowsOf && notice(t('boxed'))}
        {c.firstRead && !c.switchOn && c.game && notice(t('switchOff'))}
        {c.firstRead && c.switchOn && c.game && !c.applied && !c.held && notice(t('notApplied'))}
        {c.held &&
          notice(
            t('held', { would: c.held.would, kept: c.held.kept }),
            'warn',
            <form action={releaseAction.bind(null, c.watch.id)}>
              <Button type="submit" size="sm" variant="outline">
                {t('release')}
              </Button>
            </form>,
          )}
        {c.kindOff &&
          notice(
            t('kindOff', { count: c.wouldDrop }),
            'info',
            <form action={turnOnRulesAction.bind(null, c.watch.id)}>
              <Button type="submit" size="sm" variant="outline">
                {t('turnOn')}
              </Button>
            </form>,
          )}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] min-[2400px]:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <section className="rounded-xl border bg-card p-4">
          <OpenOnWide summary={<h2>{t('rules')}</h2>}>
            <p className="text-xs text-muted-foreground">{t('rulesShared')}</p>
            <p className="text-sm">
              <span className="text-muted-foreground">{t('consoleLabel')}: </span>
              {c.product.platform || c.rules.console || t('consoleNone')}
            </p>
            {c.game ? (
              // The item's own words as stored (fix C8): the console's words are not copied in.
              <RulesForm
                wishId={c.watch.id}
                edition={c.own?.edition ?? ''}
                required={c.own?.required ?? []}
                excluded={c.own?.excluded ?? []}
              />
            ) : null}
          </OpenOnWide>
        </section>

        {c.firstRead && (
          <div className="grid grid-cols-1 items-start gap-5 min-[1800px]:grid-cols-2">
            <section className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{t('sales')}</h2>
                {c.sales.length > 0 && (
                  <p
                    className={cn(
                      'text-xs text-muted-foreground',
                      sampled && 'cursor-help underline decoration-dotted underline-offset-2',
                    )}
                    title={sampled ? t('sampleHint') : undefined}
                  >
                    {counts(salesKept, salesDropped, salesWould, 'keptCount')}
                  </p>
                )}
              </div>
              {c.game && c.sales.length > 0 && (
                <Confirm
                  confirmed={c.salesConfirmed}
                  blocked={c.salesFailureStands && !isAdmin}
                  awaiting={c.awaitsRead ? awaiting : null}
                  blockedText={t('failureStands')}
                  doneText={t('salesConfirmed')}
                  label={t('confirmSales')}
                  hint={t('confirmHint')}
                  action={confirmSalesAction.bind(null, c.watch.id, c.salesHash)}
                />
              )}
              {c.sales.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('noSales')}</p>
              )}
              {c.sales.map((s) => (
                <div key={s.source} className="space-y-1">
                  {c.sales.length > 1 && (
                    <p className="text-xs font-medium text-muted-foreground">
                      {sourceLabel(s.source)}
                    </p>
                  )}
                  <SampleRows>{s.sample.map((x) => saleLine(s.source, x))}</SampleRows>
                  {s.droppedSample.length > 0 && (
                    <DroppedRows label={droppedLabel(s.dropped, s.would)}>
                      {s.droppedSample.map((x) => saleLine(s.source, x, x.reason))}
                    </DroppedRows>
                  )}
                </div>
              ))}
            </section>

            <section className="space-y-3 rounded-xl border bg-card p-4">
              <h2 className="font-semibold">{t('listings')}</h2>
              {c.listings.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('noListings')}</p>
              )}
              {c.listings.map((l) => (
                <div key={l.source} className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {sourceLabel(l.source)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {counts(l.kept, l.dropped.length - l.would, l.would, 'shownCount')}
                    </p>
                  </div>
                  {c.game && (
                    <Confirm
                      confirmed={l.confirmed}
                      blocked={l.failureStands && !isAdmin}
                      awaiting={c.awaitsRead ? awaiting : null}
                      blockedText={t('failureStands')}
                      doneText={t('listingsConfirmed')}
                      label={t('confirmListings')}
                      hint={t('confirmListingsHint')}
                      action={confirmListingsAction.bind(null, c.watch.id, l.source, l.hash)}
                    />
                  )}
                  <SampleRows>{l.sample.map((o) => listingLine(l.source, o, false))}</SampleRows>
                  {l.dropped.length > 0 && (
                    <DroppedRows label={droppedLabel(l.dropped.length - l.would, l.would)}>
                      {l.dropped.map((o) => listingLine(l.source, o, true))}
                    </DroppedRows>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Title({
  title,
  url,
  fallback,
}: {
  title: string | null;
  url: string | null;
  fallback: string;
}) {
  const text = title || fallback;
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="line-clamp-2 break-words underline-offset-2 hover:underline"
    >
      {text}
    </a>
  ) : (
    <span className="line-clamp-2 break-words">{text}</span>
  );
}

/**
 * A confirm button, or why there is none: confirmed already (a badge), the rules changed since the
 * last read (fix C6), or a failed check stands.
 */
function Confirm({
  confirmed,
  blocked,
  awaiting,
  blockedText,
  doneText,
  label,
  hint,
  action,
}: {
  confirmed: boolean;
  blocked: boolean;
  awaiting: React.ReactNode;
  blockedText: string;
  doneText: string;
  label: string;
  hint: string;
  action: () => Promise<void>;
}) {
  if (confirmed)
    return (
      <p className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        <Check className="size-3.5" /> {doneText}
      </p>
    );
  if (awaiting) return awaiting;
  if (blocked) return <p className="text-xs text-amber-700 dark:text-amber-300">{blockedText}</p>;
  return (
    <form action={action}>
      <Button type="submit" size="sm" title={hint}>
        {label}
      </Button>
    </form>
  );
}
