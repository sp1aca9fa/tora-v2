'use client';

import type { LotteryMark } from '@tora/db';
import { Check, EyeOff, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useRef, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { lotteryMarkAction, morePostsAction } from './actions';
import type { PostView, PostsFilter } from './post-views';
import { threads } from './threads';

/**
 * Messages posted after this are new to the reader (a Now row's last opening, S25): tinted for a
 * moment when shown, their replies unfolded. Null elsewhere.
 */
export const FreshSince = createContext<string | null>(null);

/** A lottery post's marks (Stores > Lotteries): interested, applied, hidden; a second tap clears. */
function LotteryMarks({ postId, mark: saved }: { postId: string; mark: LotteryMark | null }) {
  const t = useTranslations('stores');
  const [mark, setMark] = useState(saved);
  const [, startTransition] = useTransition();
  const options = [
    ['interested', Star],
    ['applied', Check],
    ['hidden', EyeOff],
  ] as const;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {options.map(([m, Icon]) => {
        const on = mark === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const [had, next] = [mark, on ? null : m];
              setMark(next);
              startTransition(async () => {
                // Not saved (the post is gone, or no connection): the button says so.
                const ok = await lotteryMarkAction(postId, next).catch(() => false);
                if (!ok) setMark(had);
              });
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors',
              on
                ? m === 'hidden'
                  ? 'border-foreground/40 bg-muted font-medium'
                  : 'border-primary bg-primary text-primary-foreground'
                : 'border-foreground/25 hover:bg-accent',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(on && m === 'hidden' ? 'lottery.unhide' : `lottery.${m}`)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One post: the stores it names first (left out under a store's own heading), then who, the
 * text, its codes spelled out, its pictures, and its replies folded.
 */
export function PostItem({
  post: p,
  replies = [],
  stores = true,
}: {
  post: PostView;
  replies?: PostView[];
  stores?: boolean;
}) {
  const t = useTranslations('stores');
  const since = useContext(FreshSince);
  const fresh = (v: PostView) => since !== null && v.postedAt > since;
  const meta = [p.author, p.reply && t('comment')].filter(Boolean).join(' · ');
  return (
    <li className={cn('space-y-1 py-2.5', stores && !p.mine && 'opacity-70')}>
      <div
        className={cn('-mx-2 space-y-1 rounded-md px-2', fresh(p) && 'fresh')}
        data-fresh={fresh(p) ? p.postedAt : undefined}
      >
        <div className="flex items-baseline justify-between gap-3">
          {stores ? (
            <p
              className={cn('text-sm', p.names.length ? 'font-semibold' : 'text-muted-foreground')}
            >
              {p.names.length ? p.names.join(', ') : t('unknownStore')}
            </p>
          ) : (
            <p className="min-w-0 truncate text-xs text-muted-foreground">{meta}</p>
          )}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.at}</span>
        </div>
        {stores && meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        <p className="text-sm break-words">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
              {p.text}
            </a>
          ) : (
            p.text
          )}
        </p>
        {p.decoded.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {p.decoded.map((d, i) => (
              <span key={`${d.code}|${d.meaning}`}>
                {i > 0 && ' · '}
                <span className="text-foreground">{d.code}</span> {d.meaning}
              </span>
            ))}
          </p>
        )}
        {p.lottery && <LotteryMarks postId={p.id} mark={p.lottery.mark} />}
        {p.images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {p.images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer">
                {/* A picture stored by the app; next/image optimisation is not needed. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-24 max-w-40 rounded border object-cover"
                />
              </a>
            ))}
          </div>
        )}
      </div>
      {replies.length > 0 && (
        <details className="pt-1" open={replies.some(fresh) || undefined}>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {t('replies', { n: replies.length })}
          </summary>
          <ul className="mt-1 divide-y border-l pl-3">
            {replies.map((r) => (
              <PostItem key={r.id} post={r} stores={false} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** The posts, more loaded as the end of the list comes into view (S25). */
export function PostsList({
  initial,
  more: initialMore,
  filter,
}: {
  initial: PostView[];
  more: boolean;
  filter: PostsFilter;
}) {
  const t = useTranslations('stores');
  const [posts, setPosts] = useState(initial);
  const [more, setMore] = useState(initialMore);
  const [loading, setLoading] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = end.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry?.isIntersecting || loading) return;
        setLoading(true);
        try {
          const last = posts[posts.length - 1]!;
          const next = await morePostsAction({ postedAt: last.postedAt, id: last.id }, filter);
          setPosts((had) => [...had, ...next.posts.filter((p) => !had.some((h) => h.id === p.id))]);
          setMore(next.more);
        } finally {
          setLoading(false);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [posts, more, loading, filter]);

  if (!posts.length) {
    return (
      <p className="py-3 text-sm text-muted-foreground">
        {filter.lottery ? t(`lottery.empty.${filter.lottery}`) : t('noPosts')}
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y">
        {threads(posts).map(({ post, replies }) => (
          <PostItem key={post.id} post={post} replies={replies} />
        ))}
      </ul>
      <div ref={end} className="py-2 text-center text-xs text-muted-foreground">
        {more ? (loading ? t('loading') : '') : t('noMore')}
      </div>
    </>
  );
}
