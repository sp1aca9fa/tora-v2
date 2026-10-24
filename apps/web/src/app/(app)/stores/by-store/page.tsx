import { PLACE } from '@tora/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { areaLocations } from '../locations';
import { postViews } from '../post-views';
import { PostsList } from '../posts-list';
import { AutoRefresh } from '../stores-nav';

/** The boards of chains mixing many (the posts with no chain). */
const OTHER = 'other';

/**
 * A chain's board as posted, decoded (S25): a button per chain (the boards mixing chains last),
 * then optionally one of its stores in the person's area; the posts newest first.
 */
export default async function ByStorePage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; store?: string }>;
}) {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const [t, { all, inArea, label }, asked] = await Promise.all([
    getTranslations('stores'),
    areaLocations(db, area),
    searchParams,
  ]);
  const boards = [
    ...new Map(all.filter((s) => s.chain !== PLACE).map((s) => [s.chain, s.chainLabel ?? s.chain])),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const board =
    asked.board === OTHER || boards.some(([c]) => c === asked.board)
      ? asked.board!
      : (boards[0]?.[0] ?? OTHER);
  const stores = all
    .filter((s) => s.chain === board && inArea.has(s.id))
    .sort((a, b) => label(a).localeCompare(label(b)));
  const store = stores.find((s) => s.id === asked.store) ?? null;
  const filter = {
    chain: board === OTHER ? null : board,
    storeIds: store ? [store.id] : undefined,
  };
  const first = await postViews(db, area, { offset: 0, filter });
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );
  const href = (b: string, s?: string) =>
    `/stores/by-store?board=${encodeURIComponent(b)}${s ? `&store=${s}` : ''}`;

  return (
    <section className="space-y-3">
      <AutoRefresh on="post" />
      <p className="text-sm text-muted-foreground">{t('byStoreInfo')}</p>
      <div className="flex flex-wrap gap-1.5">
        {[...boards, [OTHER, t('otherBoards')] as const].map(([b, name]) => (
          <Link key={b} href={href(b)} className={chip(b === board)}>
            {name}
          </Link>
        ))}
      </div>
      {stores.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <Link href={href(board)} className={chip(!store)}>
            {t('allOfChain')}
          </Link>
          {stores.map((s) => (
            <Link key={s.id} href={href(board, s.id)} className={chip(s.id === store?.id)}>
              {s.name}
            </Link>
          ))}
        </div>
      )}
      <div className="rounded-xl border bg-card px-4">
        <PostsList
          key={`${board}|${store?.id ?? ''}|${first.posts[0]?.id ?? ''}`}
          initial={first.posts}
          more={first.more}
          filter={filter}
        />
      </div>
    </section>
  );
}
