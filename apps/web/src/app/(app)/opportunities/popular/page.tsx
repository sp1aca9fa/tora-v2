import { type RankingBoard, imageVersions, rankingBoards } from '@tora/db';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ProductImage } from '@/components/product-image';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';

/** Shown at first per ranking; the rest open on demand. */
const FIRST = 10;

/** Popular now (S13 part 3, as a sub page S26): each ranking with pictures and links. */
export default async function PopularPage() {
  const { db, user } = await authed();
  const [boards, t, money] = await Promise.all([
    rankingBoards(db, user.id),
    getTranslations('opportunities'),
    getMoney(),
  ]);
  const images = await imageVersions(
    db,
    boards.flatMap((b) => b.items.flatMap((i) => (i.productId ? [i.productId] : []))),
  );
  if (!boards.length) {
    return (
      <p className="max-w-3xl rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        {t('noRankings')}
      </p>
    );
  }

  const row = (i: RankingBoard['items'][number]) => {
    const week =
      i.weekAgo === null
        ? t('rankNew')
        : i.weekAgo === i.rank
          ? '='
          : `${i.weekAgo > i.rank ? '+' : '-'}${Math.abs(i.weekAgo - i.rank)}`;
    const body = (
      <>
        <span className="w-7 shrink-0 text-right text-sm font-medium tabular-nums">{i.rank}</span>
        <ProductImage
          product={{
            id: i.productId ?? i.title,
            name: i.title,
            category: i.category ?? 'tcg',
            kind: i.kind ?? 'other',
          }}
          version={i.productId ? (images.get(i.productId) ?? null) : null}
          className="size-12"
        />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="line-clamp-2 block text-sm leading-snug">{i.title}</span>
          <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {t('colWeek')} {week}
            </span>
            {i.numbers?.listings !== undefined && (
              <span>{t('listingsN', { n: i.numbers.listings })}</span>
            )}
            {i.numbers?.favorites !== undefined && (
              <span>{t('favoritesN', { n: i.numbers.favorites })}</span>
            )}
            {i.owned && <span>{t('owned')}</span>}
            {i.watching && <span>{t('watching')}</span>}
            {i.candidate && !i.owned && !i.watching && <span>{t('candidate')}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {i.price !== null ? money(i.price) : '-'}
        </span>
      </>
    );
    return (
      <li key={`${i.rank}|${i.title}`}>
        {i.productId ? (
          <Link
            href={`/products/${i.productId}`}
            className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50"
          >
            {body}
          </Link>
        ) : (
          <div className="flex items-center gap-3 px-2 py-1.5">{body}</div>
        )}
      </li>
    );
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      {boards.map((b) => (
        <section key={b.ranking} className="space-y-2">
          <div className="space-y-1">
            <h2 className="font-semibold">{b.label}</h2>
            <p className="max-w-3xl text-xs text-muted-foreground">
              {t('popularIntro', { day: b.day })}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-1">
            <ul className="divide-y">{b.items.slice(0, FIRST).map(row)}</ul>
            {b.items.length > FIRST && (
              <details className="group">
                <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:text-foreground group-open:hidden">
                  {t('showAll', { count: b.items.length })}
                </summary>
                <ul className="divide-y border-t">{b.items.slice(FIRST).map(row)}</ul>
              </details>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
