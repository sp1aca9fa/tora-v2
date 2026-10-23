'use client';

import {
  CONDITIONS,
  type CardGrade,
  type Condition,
  NOTICE_LEVELS,
  type NoticeLevel,
  type NoticeType,
  type ProductClass,
  RAW_GRADES,
} from '@tora/core';
import { ChevronDown, ChevronRight, ExternalLink, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { FormError } from '@/components/form-error';
import { LEVEL_STYLE } from '@/components/notice-level';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  type ReviewRow,
  confirmReviewAction,
  removeLinkAction,
  retryLinkAction,
} from '../imports/actions';
import type { ReviewItem } from '../imports/review/review-item';
import { ReviewRowFields, initialRow } from '../imports/review/review-row';
import { LinkUrlForm } from '../products/[id]/link-url-form';
import {
  confirmCandidateAction,
  linkUrlAction,
  rejectCandidateAction,
} from '../products/[id]/source-actions';
import {
  dismissSourceQualityAction,
  setLotConditionAction,
  setLotGradeAction,
  keepSetupDefaultsAction,
  setSourceWarningAction,
} from './actions';
import { useMoney } from '@/components/money-context';

/** One action as the page shows it (built on the server from `pendingActions`). */
export interface ActionCardView {
  key: string;
  type: NoticeType;
  level: NoticeLevel;
  kind: 'source' | 'lot' | 'link' | 'suggestion' | 'quality' | 'setup';
  title: string;
  /** Kind, set, number... */
  meta: string;
  /** The closed card's second line: what is needed. */
  summary: string;
  image: string | null;
  /** Where the full page for this action is (item, lot, import review...). */
  href: string;
  productId?: string;
  source?: string;
  sourceLabel?: string;
  main?: boolean;
  /** "2 units · paid ¥36,000" or "x1 · ¥3,000 · 2026-05-01". */
  owned?: string;
  candidates?: {
    id: string;
    title: string;
    url: string | null;
    image: string | null;
    priceBase: number | null;
    score: number;
  }[];
  holdingId?: string;
  /** An imported lot waiting for review. */
  review?: ReviewItem;
  /** The item class a source quality notice is about. */
  qualityClass?: ProductClass;
  /** The setup card's button: keep the defaults as they are. */
  setupKeep?: string;
  /** A purchase link that failed. */
  linkId?: string;
  url?: string;
  /** Rendered on the server (a data review suggestion and its Accept / Dismiss). */
  body?: ReactNode;
}

// Which cards and sections the viewer opened or closed, kept in this browser only.
const OPEN_KEY = 'tora.actions.open';
const OPEN_EVENT = 'tora-actions-open';
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) ?? '';
  } catch {
    return '';
  }
};
const subscribeOpen = (onChange: () => void) => {
  window.addEventListener(OPEN_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(OPEN_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
function useOpenCards() {
  const raw = useSyncExternalStore(subscribeOpen, readOpen, () => '');
  const open = useMemo<Record<string, boolean>>(() => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [raw]);
  const set = (key: string, value: boolean) => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...open, [key]: value }));
    } catch {
      // Storage off (private window): the card still toggles until the next render.
    }
    window.dispatchEvent(new Event(OPEN_EVENT));
  };
  return [open, set] as const;
}

/** The Actions list: level filters, search, and a section per notice type, settled in place. */
export function ActionsList({ cards }: { cards: ActionCardView[] }) {
  const t = useTranslations();
  const [level, setLevel] = useState<NoticeLevel | 'all'>('all');
  const [q, setQ] = useState('');
  // Settled cards disappear at once; the server's next render drops them for good.
  const [done, setDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useOpenCards();
  const live = cards.filter((c) => !done.has(c.key));
  const perLevel = new Map<NoticeLevel, number>();
  for (const c of live) perLevel.set(c.level, (perLevel.get(c.level) ?? 0) + 1);
  const needle = q.trim().toLowerCase();
  const shown = live.filter(
    (c) =>
      (level === 'all' || c.level === level) &&
      (!needle || `${c.title} ${c.meta}`.toLowerCase().includes(needle)),
  );
  // One section per notice type, in the cards' order (most urgent level first).
  const sections = new Map<NoticeType, ActionCardView[]>();
  for (const c of shown) sections.set(c.type, [...(sections.get(c.type) ?? []), c]);
  const settle = (key: string) => setDone((d) => new Set(d).add(key));
  const chip = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLevel('all')}
          className={cn(
            chip,
            level === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {t('actions.all')} {live.length}
        </button>
        {NOTICE_LEVELS.filter((l) => perLevel.has(l)).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLevel(level === l ? 'all' : l)}
            aria-pressed={level === l}
            className={cn(chip, LEVEL_STYLE[l].banner, level === l && 'ring-2 ring-foreground/30')}
          >
            <span className={cn('size-2.5 rounded-full', LEVEL_STYLE[l].dot)} />
            {t(`notices.short.${l}`)} {perLevel.get(l)}
          </button>
        ))}
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('actions.search')}
          aria-label={t('actions.search')}
          className="h-8 w-full sm:ml-auto sm:w-56"
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {live.length === 0 ? t('actions.none') : t('actions.noneShown')}
        </p>
      ) : (
        <div className="space-y-4">
          {[...sections].map(([type, list]) => {
            const sectionOpen = open[`type:${type}`] ?? true;
            const style = LEVEL_STYLE[list[0]!.level];
            return (
              <section key={type} className="space-y-2">
                <button
                  type="button"
                  onClick={() => setOpen(`type:${type}`, !sectionOpen)}
                  aria-expanded={sectionOpen}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium',
                    style.banner,
                  )}
                >
                  <span className={cn('size-2.5 shrink-0 rounded-full', style.dot)} />
                  <span className="flex-1">
                    {t(`actions.section.${type}`, { count: list.length })}
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 transition-transform',
                      sectionOpen && 'rotate-180',
                    )}
                  />
                </button>
                {sectionOpen && (
                  <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:items-start">
                    {list.map((c) => (
                      <ActionCard
                        key={c.key}
                        card={c}
                        open={open[c.key] ?? c.level === 'red'}
                        onToggle={(value) => setOpen(c.key, value)}
                        onSettled={() => settle(c.key)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionCard({
  card: c,
  open,
  onToggle,
  onSettled,
}: {
  card: ActionCardView;
  open: boolean;
  onToggle: (open: boolean) => void;
  onSettled: () => void;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  /** Runs a server action; the card goes once it is done (unless it answers false). */
  const run: Run = (action) =>
    startTransition(async () => {
      if ((await action()) !== false) onSettled();
    });
  const openLabel =
    c.kind === 'source'
      ? t('actions.openItem')
      : c.type === 'import_review'
        ? t('actions.openReview')
        : c.kind === 'lot'
          ? t('actions.openLot')
          : c.kind === 'link'
            ? t('actions.openImports')
            : c.kind === 'quality'
              ? t('actions.openSettings')
              : c.kind === 'setup'
                ? t('actions.setup.open')
                : t('actions.openDataReview');

  return (
    <li
      className={cn(
        'rounded-xl border border-l-4 bg-card',
        LEVEL_STYLE[c.level].bar,
        pending && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <Thumb src={c.image} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{c.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{c.summary}</span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {c.kind === 'quality' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('actions.quality.explain')}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => dismissSourceQualityAction(c.source!, c.qualityClass!))}
              >
                {t('actions.quality.dismiss')}
              </Button>
            </div>
          )}
          {c.kind === 'setup' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('actions.setup.explain')}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => keepSetupDefaultsAction())}
              >
                {c.setupKeep}
              </Button>
            </div>
          )}
          {c.kind !== 'link' && c.kind !== 'quality' && c.kind !== 'setup' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex gap-3 rounded-md border p-2">
                <Thumb src={c.image} className="size-16" />
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="text-xs text-muted-foreground">{t('actions.yourItem')}</p>
                  <p className="line-clamp-2 font-medium">{c.title}</p>
                  {c.meta && <p className="text-xs text-muted-foreground">{c.meta}</p>}
                  {c.owned && <p className="amount text-xs text-muted-foreground">{c.owned}</p>}
                </div>
              </div>
              {c.kind === 'source' && c.candidates?.[0] && (
                <Candidate candidate={c.candidates[0]} label={c.sourceLabel ?? ''} />
              )}
            </div>
          )}

          {c.kind === 'source' && <SourceControls card={c} pending={pending} run={run} />}
          {c.type === 'card_grade' && (
            <GradeButtons holdingId={c.holdingId!} pending={pending} run={run} />
          )}
          {c.type === 'game_condition' && (
            <ConditionButtons holdingId={c.holdingId!} pending={pending} run={run} />
          )}
          {c.review && <ReviewControls item={c.review} pending={pending} run={run} />}
          {c.kind === 'link' && <LinkControls card={c} pending={pending} run={run} />}
          {c.body}

          <Link
            href={c.href}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {openLabel}
            <ChevronRight className="size-3" />
          </Link>
        </div>
      )}
    </li>
  );
}

/** An imported lot's review controls (as on the import review page) and Confirm. */
function ReviewControls({ item, pending, run }: { item: ReviewItem; pending: boolean; run: Run }) {
  const t = useTranslations();
  const [row, setRow] = useState<ReviewRow>(() => initialRow(item));
  const [error, setError] = useState<{ error?: string; fields?: string[] }>({});
  const confirm = () => {
    const form = new FormData();
    form.set('payload', JSON.stringify([row]));
    // A card without a grade is confirmed as is; it then asks for its grade with the others.
    form.set('mode', 'all');
    run(async () => {
      const result = await confirmReviewAction({}, form);
      setError(result);
      return !result.error;
    });
  };
  return (
    <div className="space-y-2">
      <ReviewRowFields
        item={item}
        row={row}
        update={(_, patch) => setRow((r) => ({ ...r, ...patch }))}
        candidates={[]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          variant={row.cancelled ? 'destructive' : 'default'}
          onClick={confirm}
        >
          {row.cancelled ? t('actions.removeLot') : t('actions.confirmLot')}
        </Button>
        <FormError state={error} />
      </div>
    </div>
  );
}

/** A purchase link that failed: try again, add the purchase by hand, or drop it. */
function LinkControls({
  card: c,
  pending,
  run,
}: {
  card: ActionCardView;
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-2 text-sm">
      <a
        href={c.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 break-all underline"
      >
        {c.url} <ExternalLink className="size-3 shrink-0" />
      </a>
      <p className="text-xs text-muted-foreground">{c.summary}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => retryLinkAction(c.linkId!))}>
          <RotateCw className="size-3.5" /> {t('imports.links.retry')}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/add?link=${c.linkId}`}>{t('imports.links.addByHand')}</Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => removeLinkAction(c.linkId!))}
        >
          {t('imports.links.remove')}
        </Button>
      </div>
    </div>
  );
}

function Thumb({ src, className }: { src: string | null; className: string }) {
  return src ? (
    // Stored thumbnails and the listings' own pictures (loaded from the site, as on the item page).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      className={cn('shrink-0 rounded object-contain', className)}
    />
  ) : (
    <span className={cn('shrink-0 rounded bg-muted', className)} />
  );
}

function Candidate({
  candidate: s,
  label,
}: {
  candidate: NonNullable<ActionCardView['candidates']>[number];
  label: string;
}) {
  const money = useMoney();
  const t = useTranslations();
  return (
    <div className="flex gap-3 rounded-md border p-2">
      <Thumb src={s.image} className="size-16" />
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className="text-xs text-muted-foreground">{label}</p>
        <a
          href={s.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 font-medium hover:underline"
        >
          {s.title} <ExternalLink className="inline size-3" />
        </a>
        <p className="text-xs text-muted-foreground">
          {s.priceBase ? <span className="amount">{money(s.priceBase)} · </span> : ''}
          {t('sources.score', { score: Math.round(s.score * 100) })}
        </p>
      </div>
    </div>
  );
}

type Run = (action: () => Promise<unknown>) => void;

function SourceControls({
  card: c,
  pending,
  run,
}: {
  card: ActionCardView;
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations();
  const [first, ...rest] = c.candidates ?? [];
  const [more, setMore] = useState(false);
  return (
    <div className="space-y-3">
      {first && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => confirmCandidateAction(first.id))}
          >
            {t('sources.confirm')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            // Rejecting the last suggestion leaves the "paste a link" card for a main source.
            onClick={() =>
              startReject(run, rejectCandidateAction, first.id, rest.length === 0 && !c.main)
            }
          >
            {t('sources.reject')}
          </Button>
        </div>
      )}
      {rest.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setMore(!more)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('actions.moreSuggestions', { count: rest.length })}
          </button>
          {more &&
            rest.map((s) => (
              <div key={s.id} className="space-y-2">
                <Candidate candidate={s} label={c.sourceLabel ?? ''} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => confirmCandidateAction(s.id))}
                  >
                    {t('sources.confirm')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => startReject(run, rejectCandidateAction, s.id, false)}
                  >
                    {t('sources.reject')}
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {t('actions.paste', { source: c.sourceLabel ?? '' })}
        </p>
        <LinkUrlForm
          action={linkUrlAction.bind(null, c.productId!)}
          label={t('actions.paste', { source: c.sourceLabel ?? '' })}
        />
      </div>
      {c.main && (
        <Button
          size="sm"
          variant="ghost"
          className="text-xs"
          disabled={pending}
          onClick={() => run(() => setSourceWarningAction(c.productId!, true))}
        >
          {t('coverage.dismiss')}
        </Button>
      )}
    </div>
  );
}

/** Rejects a suggestion; the card goes only when nothing is left on it. */
function startReject(run: Run, reject: (id: string) => Promise<void>, id: string, last: boolean) {
  if (last) run(() => reject(id));
  else void reject(id);
}

function GradeButtons({
  holdingId,
  pending,
  run,
}: {
  holdingId: string;
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations();
  const set = (grade: CardGrade) => run(() => setLotGradeAction(holdingId, grade));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-14 text-xs text-muted-foreground">{t('grading.raw')}</span>
        {RAW_GRADES.map((g) => (
          <Button
            key={g}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => set({ grading: 'raw', rawGrade: g })}
          >
            {g}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-14 text-xs text-muted-foreground">{t('grading.graded')}</span>
        {(['10', '9'] as const).map((g) => (
          <Button
            key={g}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => set({ grading: 'graded', grader: 'PSA', grade: g })}
          >
            PSA {g}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ConditionButtons({
  holdingId,
  pending,
  run,
}: {
  holdingId: string;
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap gap-1.5">
      {CONDITIONS.map((condition: Condition) => (
        <Button
          key={condition}
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => setLotConditionAction(holdingId, condition))}
        >
          {t(`condition.${condition}`)}
        </Button>
      ))}
    </div>
  );
}
