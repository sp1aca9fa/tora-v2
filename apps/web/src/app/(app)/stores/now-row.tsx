'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { markLocationSeenAction } from './actions';
import { FreshSince } from './posts-list';

/** Without a scroll, tap or key for this long, the reader has left an open row. */
const IDLE_MS = 60_000;

/** Tells the list which rows are open (their order is kept meanwhile). */
const RowOpened = createContext<(id: string, open: boolean) => void>(() => {});

/**
 * The Now rows (S25), newest first; while one is open the order stays as it was, so nothing
 * moves under the reader (rows new since then go on top), and it catches up once all are closed.
 */
export function NowList({ rows }: { rows: { id: string; node: React.ReactNode }[] }) {
  const [opened, setOpened] = useState<string[]>([]);
  const [kept, setKept] = useState<string[] | null>(null);
  const ids = rows.map((r) => r.id);
  const order = kept
    ? [...ids.filter((id) => !kept.includes(id)), ...kept.filter((id) => ids.includes(id))]
    : ids;
  const byId = new Map(rows.map((r) => [r.id, r.node]));
  const onOpened = (id: string, open: boolean) => {
    const next = open ? [...new Set([...opened, id])] : opened.filter((x) => x !== id);
    setOpened(next);
    setKept(next.length ? (kept ?? order) : null);
  };
  return (
    <RowOpened.Provider value={onOpened}>
      <div className="space-y-2">
        {order.map((id) => (
          <div key={id}>{byId.get(id)}</div>
        ))}
      </div>
    </RowOpened.Provider>
  );
}

/**
 * A Now row (S25): closed, its summary and how many messages came since it was last opened.
 * Opening it marks them read (on the account, so every device agrees), tints them for a moment
 * and scrolls to the newest. A message coming in while it is open closes it when the reader has
 * left it (the count shows again, nothing missed); while they read, the row stays as it is and a
 * banner at its top says how many wait, shown on a tap.
 */
export function NowRow({
  id,
  times,
  seenAt,
  dashed,
  summary,
  children,
}: {
  id: string;
  /** When each of its messages was posted, the newest first. */
  times: string[];
  /** When it was last opened ('' never). */
  seenAt: string;
  dashed: boolean;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('stores');
  const onOpened = useContext(RowOpened);
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const active = useRef(0);
  const latest = times[0] ?? '';
  const live = useRef({ latest, content: children });
  // What the reader sees while new messages wait behind the banner.
  const [held, setHeld] = useState<{ latest: string; content: React.ReactNode } | null>(null);
  const [readUpTo, setReadUpTo] = useState('');
  // Where this opening's new messages start (kept while open, so updates do not untint them).
  const [since, setSince] = useState<string | null>(null);
  const [jump, setJump] = useState(0);
  const read = seenAt > readUpTo ? seenAt : readUpTo;
  const unread = times.filter((at) => at > read).length;
  const waiting = held ? times.filter((at) => at > held.latest).length : 0;

  useEffect(() => {
    const prev = live.current;
    live.current = { latest, content: children };
    if (!open || held) return;
    if (prev.latest && latest > prev.latest) {
      if (Date.now() - active.current > IDLE_MS) ref.current!.open = false;
      else setHeld(prev);
      return;
    }
    if (read < latest) {
      setReadUpTo(latest);
      void markLocationSeenAction(id, latest);
    }
  }, [latest, children, open, held, read, id]);

  // The reader is there while they scroll, tap or type.
  useEffect(() => {
    if (!open) return;
    const here = () => {
      active.current = Date.now();
    };
    const events = ['scroll', 'pointerdown', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, here, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, here);
    };
  }, [open]);

  // To the newest new message, unless already in view.
  useEffect(() => {
    if (!jump) return;
    const fresh = [...(ref.current?.querySelectorAll<HTMLElement>('[data-fresh]') ?? [])];
    const newest = fresh.sort((a, b) =>
      (b.dataset.fresh ?? '').localeCompare(a.dataset.fresh ?? ''),
    )[0];
    if (!newest) return;
    const box = newest.getBoundingClientRect();
    if (box.top < 64 || box.bottom > window.innerHeight - 80)
      newest.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [jump]);

  return (
    <details
      ref={ref}
      className={cn('group rounded-xl border bg-card', dashed && 'border-dashed')}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        onOpened(id, now);
        if (!now) return setHeld(null);
        active.current = Date.now();
        setSince(read);
        setJump((n) => n + 1);
      }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1 space-y-0.5">{summary}</div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {!open && unread > 0 && (
            <span
              className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-medium text-primary-foreground tabular-nums"
              aria-label={t('unread', { n: unread })}
              title={t('unread', { n: unread })}
            >
              {unread}
            </span>
          )}
          <span className="text-xs text-muted-foreground group-open:rotate-90" aria-hidden>
            ▸
          </span>
        </div>
      </summary>
      {held && waiting > 0 && (
        <button
          type="button"
          onClick={() => {
            active.current = Date.now();
            setSince(held.latest);
            setHeld(null);
            setJump((n) => n + 1);
          }}
          className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-[5] block w-full border-y border-l-4 border-l-[var(--fresh-edge)] bg-[var(--fresh)] px-4 py-1.5 text-left text-xs font-medium md:top-0"
        >
          {t('waiting', { n: waiting })}
        </button>
      )}
      <FreshSince.Provider value={since}>{held ? held.content : children}</FreshSince.Provider>
    </details>
  );
}
