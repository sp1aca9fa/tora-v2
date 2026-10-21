'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { morePostsAction } from './actions';
import type { PostView } from './post-views';

/** The posts, more loaded as the end of the list comes into view (S25). */
export function PostsList({
  initial,
  more: initialMore,
  onlyArea,
}: {
  initial: PostView[];
  more: boolean;
  onlyArea: boolean;
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
          const next = await morePostsAction(posts.length, onlyArea);
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
  }, [posts.length, more, loading, onlyArea]);

  if (!posts.length) return <p className="text-sm text-muted-foreground">{t('noPosts')}</p>;
  return (
    <>
      <ul className="divide-y text-sm">
        {posts.map((p) => (
          <li key={p.id} className={cn('space-y-0.5 py-2', !p.mine && 'opacity-70')}>
            <p className="text-xs text-muted-foreground">
              {p.at}
              {p.author ? ` · ${p.author}` : ''} · {p.reply && `${t('comment')} · `}
              <span className={cn(p.mine && 'font-semibold text-foreground')}>
                {p.names.length ? p.names.join(', ') : t('unknownStore')}
              </span>
              {p.products.length > 0 && (
                <span className="text-foreground"> · {p.products.join(', ')}</span>
              )}
            </p>
            <p className="break-words">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {p.text}
                </a>
              ) : (
                p.text
              )}
            </p>
          </li>
        ))}
      </ul>
      <div ref={end} className="py-2 text-center text-xs text-muted-foreground">
        {more ? (loading ? t('loading') : '') : t('noMore')}
      </div>
    </>
  );
}
