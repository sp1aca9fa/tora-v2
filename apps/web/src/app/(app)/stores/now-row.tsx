'use client';

import { useTranslations } from 'next-intl';
import { CheckCheck, ChevronsDownUp } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { markAllSeenAction, markLocationSeenAction } from './actions';
import { FreshSince } from './posts-list';

/** Without a scroll, tap or key for this long, the reader has left an open row. */
const IDLE_MS = 60_000;

/** A row's opening: how many times it was opened, where its new messages start, whether any. */
const Opening = createContext({ count: 0, since: null as string | null, any: false });

/** Whether a point is on a character of text (not the empty space around it). */
function onText(x: number, y: number): boolean {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const at = doc.caretPositionFromPoint
    ? doc.caretPositionFromPoint(x, y)
    : (() => {
        const r = document.caretRangeFromPoint?.(x, y);
        return r ? { offsetNode: r.startContainer, offset: r.startOffset } : null;
      })();
  const node = at?.offsetNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const range = document.createRange();
  for (const o of [at.offset - 1, at.offset]) {
    if (o < 0 || o >= (node.textContent ?? '').length) continue;
    range.setStart(node, o);
    range.setEnd(node, o + 1);
    for (const b of range.getClientRects())
      if (x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2) return true;
  }
  return false;
}

/**
 * A tap on an open row's empty space (not on text, a link or a picture) folds what it is in: a
 * store's posts, a post's replies, or the row; its heading comes back into view if gone.
 */
function foldOnTap(e: React.MouseEvent<HTMLElement>) {
  const target = e.target as HTMLElement;
  if (target.closest('summary, a, button, img, input, select, textarea, label')) return;
  if (!window.getSelection()?.isCollapsed || onText(e.clientX, e.clientY)) return;
  const fold = target.closest('details');
  if (!fold?.open) return;
  fold.open = false;
  const head = fold.querySelector(':scope > summary');
  if (head && head.getBoundingClientRect().top < 56) head.scrollIntoView({ block: 'start' });
}

/**
 * A store's posts in a Now row: folded, opened by itself when it holds a new message (or, none
 * being new, when it is the row's newest); the reader folds and unfolds it.
 */
export function StoreSection({
  name,
  times,
  newest,
  children,
}: {
  name: string;
  /** When its messages were posted. */
  times: string[];
  /** The row's store with the latest message. */
  newest: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations('stores');
  const { count, since, any } = useContext(Opening);
  const fresh = since !== null && times.some((at) => at > since);
  const [open, setOpen] = useState(false);
  // Set while rendering, so the posts are shown before the row scrolls to the newest.
  const [was, setWas] = useState({ count: 0, since: null as string | null });
  if (was.count !== count || was.since !== since) {
    setWas({ count, since });
    if (was.count !== count) setOpen(fresh || (!any && newest));
    else if (fresh) setOpen(true);
  }
  if (!name) return <section>{children}</section>;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group/store">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t('postCount', { n: times.length })}
        </span>
        <span className="text-xs text-muted-foreground group-open/store:rotate-90" aria-hidden>
          ▸
        </span>
      </summary>
      {children}
    </details>
  );
}

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
 * The Now lists with "Mark all read" (every row's messages up to its latest, on the account),
 * on while a row has unread messages, and "Fold all" (every open row, its sections and the
 * earlier fold), on while a row is open. Always there, so opening a row moves nothing.
 */
export function NowTools({
  rows,
  unread,
  children,
}: {
  /** Every row and when its latest message was posted. */
  rows: { id: string; at: string }[];
  unread: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations('stores');
  const ref = useRef<HTMLDivElement>(null);
  const [anyOpen, setAnyOpen] = useState(false);
  const [marked, setMarked] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    const box = ref.current!;
    const check = () => setAnyOpen(!!box.querySelector('details[data-now-row][open]'));
    box.addEventListener('toggle', check, true);
    return () => box.removeEventListener('toggle', check, true);
  }, []);
  // A new message after marking shows the button again.
  const [was, setWas] = useState(unread);
  if (was !== unread) {
    setWas(unread);
    if (unread) setMarked(false);
  }
  return (
    <div ref={ref} className="space-y-2">
      {rows.length > 0 && (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={!unread || marked || pending}
            onClick={() =>
              start(async () => {
                setMarked(true);
                await markAllSeenAction(rows);
              })
            }
          >
            <CheckCheck aria-hidden />
            {t('markAllRead')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!anyOpen}
            onClick={() => {
              for (const d of ref.current!.querySelectorAll('details[open]')) {
                (d as HTMLDetailsElement).open = false;
              }
            }}
          >
            <ChevronsDownUp aria-hidden />
            {t('foldAll')}
          </Button>
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </div>
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
  startOpen = false,
  dashed,
  summary,
  children,
}: {
  id: string;
  /** When each of its messages was posted, the newest first. */
  times: string[];
  /** When it was last opened ('' never). */
  seenAt: string;
  /** Opened when the page loads (a notice's link: `?open=` its id). */
  startOpen?: boolean;
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
  const [openings, setOpenings] = useState(0);
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

  // A notice's link opens its row, in view.
  useEffect(() => {
    if (!startOpen || !ref.current) return;
    const fold = ref.current.parentElement?.closest('details');
    if (fold) fold.open = true;
    ref.current.open = true;
    ref.current.scrollIntoView({ block: 'start' });
    // Only when the page loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      data-now-row
      className={cn('group rounded-xl border bg-card', dashed && 'border-dashed')}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        onOpened(id, now);
        if (!now) return setHeld(null);
        active.current = Date.now();
        setSince(read);
        setOpenings((n) => n + 1);
        setJump((n) => n + 1);
      }}
      onClick={foldOnTap}
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
      <Opening.Provider
        value={{
          count: openings,
          since,
          any: since !== null && times.some((at) => at > since),
        }}
      >
        <FreshSince.Provider value={since}>{held ? held.content : children}</FreshSince.Provider>
      </Opening.Provider>
    </details>
  );
}
