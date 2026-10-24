import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { type PostsShown, postViews } from '../post-views';
import { PostsList } from '../posts-list';
import { AutoRefresh } from '../stores-nav';

const SHOWN: PostsShown[] = ['area', 'named', 'all'];

/**
 * Every post as it came, newest first (S25): the area's, those naming any store (the default:
 * chat and questions naming none left out), or all of them.
 */
export default async function AllPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const asked = (await searchParams).show as PostsShown | undefined;
  const show = asked && SHOWN.includes(asked) ? asked : 'named';
  const [t, first] = await Promise.all([
    getTranslations('stores'),
    postViews(db, area, { offset: 0, show }),
  ]);
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );

  return (
    <section className="space-y-3">
      <AutoRefresh on="post" />
      <p className="text-sm text-muted-foreground">{t('postsInfoPaged')}</p>
      <div className="flex flex-wrap gap-1.5">
        {SHOWN.map((s) => (
          <Link
            key={s}
            href={s === 'named' ? '/stores/posts' : `/stores/posts?show=${s}`}
            className={chip(s === show)}
          >
            {t(`shown.${s}`)}
          </Link>
        ))}
      </div>
      <div className="rounded-xl border bg-card px-4">
        <PostsList
          key={`${show}|${first.posts[0]?.id ?? ''}`}
          initial={first.posts}
          more={first.more}
          show={show}
        />
      </div>
    </section>
  );
}
