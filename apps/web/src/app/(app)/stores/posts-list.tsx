'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { morePostsAction } from './actions';
import type { PostView, PostsShown } from './post-views';
import { threads } from './threads';

/**
 * One post: the stores it names first (left out under a store's own heading), then who and what,
 * the text, its pictures, and its replies folded.
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
  const meta = [p.author, p.reply && t('comment')].filter(Boolean).join(' · ');
  return (
    <li className={cn('space-y-1 py-2.5', stores && !p.mine && 'opacity-70')}>
      <div className="flex items-baseline justify-between gap-3">
        {stores ? (
          <p className={cn('text-sm', p.names.length ? 'font-semibold' : 'text-muted-foreground')}>
            {p.names.length ? p.names.join(', ') : t('unknownStore')}
          </p>
        ) : (
          <p className="min-w-0 truncate text-xs text-muted-foreground">{meta}</p>
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.at}</span>
      </div>
      {((stores && meta) || p.products.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {stores && meta}
          {stores && meta && p.products.length > 0 && ' · '}
          <span className="text-foreground">{p.products.join(', ')}</span>
        </p>
      )}
      <p className="text-sm break-words">
        {p.url ? (
          <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
            {p.text}
          </a>
        ) : (
          p.text
        )}
      </p>
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
      {replies.length > 0 && (
        <details className="pt-1">
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
  show,
}: {
  initial: PostView[];
  more: boolean;
  show: PostsShown;
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
          const next = await morePostsAction(posts.length, show);
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
  }, [posts.length, more, loading, show]);

  if (!posts.length) return <p className="text-sm text-muted-foreground">{t('noPosts')}</p>;
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
