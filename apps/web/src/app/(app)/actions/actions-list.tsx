'use client';

import {
  CONDITIONS,
  type CardGrade,
  type Condition,
  type NoticeLevel,
  type NoticeType,
  RAW_GRADES,
} from '@tora/core';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { LEVEL_STYLE } from '@/components/notice-level';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatJpy } from '@/lib/utils';
import { LinkUrlForm } from '../products/[id]/link-url-form';
import {
  confirmCandidateAction,
  linkUrlAction,
  rejectCandidateAction,
} from '../products/[id]/source-actions';
import { setLotConditionAction, setLotGradeAction, setSourceWarningAction } from './actions';

/** One action as the page shows it (built on the server from `pendingActions`). */
export interface ActionCardView {
  key: string;
  type: NoticeType;
  level: NoticeLevel;
  kind: 'source' | 'lot' | 'count';
  title: string;
  /** Kind, set, number... (empty for count cards). */
  meta: string;
  image: string | null;
  /** The item page, the lot page, or the import page that settles a count card. */
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
    priceJpy: number | null;
    score: number;
  }[];
  holdingId?: string;
  count?: number;
}

type Group = 'all' | 'sources' | 'lots' | 'imports';
const groupOf = (c: ActionCardView): Exclude<Group, 'all'> =>
  c.kind === 'source' ? 'sources' : c.kind === 'lot' ? 'lots' : 'imports';

// Which cards the viewer opened or closed, kept in this browser only.
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

/** The Actions list: filters, search and one card per action, settled in place. */
export function ActionsList({ cards }: { cards: ActionCardView[] }) {
  const t = useTranslations();
  const [group, setGroup] = useState<Group>('all');
  const [q, setQ] = useState('');
  // Settled cards disappear at once; the server's next render drops them for good.
  const [done, setDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useOpenCards();
  const live = cards.filter((c) => !done.has(c.key));
  const counts = { all: live.length, sources: 0, lots: 0, imports: 0 };
  for (const c of live) counts[groupOf(c)]++;
  const needle = q.trim().toLowerCase();
  const shown = live.filter(
    (c) =>
      (group === 'all' || groupOf(c) === group) &&
      (!needle || `${c.title} ${c.meta}`.toLowerCase().includes(needle)),
  );
  const settle = (key: string) => setDone((d) => new Set(d).add(key));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'sources', 'lots', 'imports'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            disabled={g !== 'all' && counts[g] === 0}
            className={cn(
              'rounded-full border px-3 py-1 text-sm disabled:opacity-40',
              group === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            {t(`actions.group.${g}`)} {counts[g]}
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
        <ul className="space-y-2">
          {shown.map((c) => (
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
  /** Runs a server action; the card goes once it is done. */
  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      await action();
      onSettled();
    });
  const bar = cn('rounded-xl border border-l-4 bg-card', LEVEL_STYLE[c.level].bar);

  if (c.kind === 'count') {
    return (
      <li className={bar}>
        <Link
          href={c.href}
          className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50"
        >
          <span className="flex-1">{t(`actions.count.${c.type}`, { count: c.count ?? 0 })}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </li>
    );
  }

  const summary =
    c.kind === 'source'
      ? c.candidates?.length
        ? t('actions.suggestions', { count: c.candidates.length, source: c.sourceLabel ?? '' })
        : t('actions.noSuggestion', { source: c.sourceLabel ?? '' })
      : t(`actions.need.${c.type}`);

  return (
    <li className={cn(bar, pending && 'opacity-60')}>
      <button
        type="button"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <Thumb src={c.image} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{c.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t(`actions.type.${c.type}`)} · {summary}
          </span>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-md border p-2">
              <Thumb src={c.image} className="size-16" />
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="text-xs text-muted-foreground">{t('actions.yourItem')}</p>
                <p className="line-clamp-2 font-medium">{c.title}</p>
                {c.meta && <p className="text-xs text-muted-foreground">{c.meta}</p>}
                {c.owned && <p className="text-xs text-muted-foreground">{c.owned}</p>}
              </div>
            </div>
            {c.kind === 'source' && c.candidates?.[0] && (
              <Candidate candidate={c.candidates[0]} label={c.sourceLabel ?? ''} />
            )}
          </div>

          {c.kind === 'source' && <SourceControls card={c} pending={pending} run={run} />}
          {c.kind === 'lot' && c.type === 'card_grade' && (
            <GradeButtons holdingId={c.holdingId!} pending={pending} run={run} />
          )}
          {c.kind === 'lot' && c.type === 'game_condition' && (
            <ConditionButtons holdingId={c.holdingId!} pending={pending} run={run} />
          )}

          <Link
            href={c.href}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {c.kind === 'lot' ? t('actions.openLot') : t('actions.openItem')}
            <ChevronRight className="size-3" />
          </Link>
        </div>
      )}
    </li>
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
          {s.priceJpy ? `${formatJpy(s.priceJpy)} · ` : ''}
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
        <LinkUrlForm action={linkUrlAction.bind(null, c.productId!)} />
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
