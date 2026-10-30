import { storeGlossary } from '@tora/db';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { LOTTERY_SHOWN, type LotteryShown, postViews } from '../post-views';
import { PostsList } from '../posts-list';
import { AutoRefresh } from '../stores-nav';

/**
 * Lotteries (2026-10-31): every post using a lottery word (the Codes page marks them), newest
 * first, each marked by the person as interested, applied or hidden.
 */
export default async function LotteriesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { db, user } = await authed();
  const asked = (await searchParams).show;
  const show: LotteryShown = LOTTERY_SHOWN.find((s) => s === asked) ?? 'open';
  const [t, words, first] = await Promise.all([
    getTranslations('stores'),
    storeGlossary(db),
    postViews(db, user.preferences?.storeArea ?? null, {
      offset: 0,
      userId: user.id,
      filter: { lottery: show },
    }),
  ]);
  const lotteryWords = words.filter((w) => w.lottery).map((w) => w.code);
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );

  return (
    <section className="space-y-3">
      <AutoRefresh on="post" />
      <p className="max-w-3xl text-sm text-muted-foreground">
        {lotteryWords.length
          ? t('lottery.intro', { words: lotteryWords.join(', ') })
          : t('lottery.noWords')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {LOTTERY_SHOWN.map((s) => (
          <Link
            key={s}
            href={s === 'open' ? '/stores/lotteries' : `/stores/lotteries?show=${s}`}
            className={chip(s === show)}
          >
            {t(`lottery.shown.${s}`)}
          </Link>
        ))}
      </div>
      <div className="rounded-xl border bg-card px-4">
        <PostsList
          key={`${show}|${first.posts[0]?.id ?? ''}`}
          initial={first.posts}
          more={first.more}
          filter={{ lottery: show }}
        />
      </div>
    </section>
  );
}
