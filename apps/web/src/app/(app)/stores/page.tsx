import { PLACE, codeIndex, localDate, storesInArea } from '@tora/core';
import { cachedStores, storeCodes, storeGlossary } from '@tora/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { AddGlossary, RemoveGlossary } from './store-area';
import { postViews } from './post-views';
import { PostsList } from './posts-list';
import { AutoRefresh } from './stores-nav';

/**
 * Store notices, the main sub page (S25): the latest posts, the area's first, and what the codes
 * posters use stand for. Before an area is set, the Area page comes first.
 */
export default async function StorePostsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const { show } = await searchParams;
  const onlyArea = show === 'area';
  const [t, all, codesList, first] = await Promise.all([
    getTranslations('stores'),
    cachedStores(db),
    storeGlossary(db),
    postViews(db, area, { offset: 0, onlyArea }),
  ]);
  // The admins' product codes first (they win over the board's list's).
  const products = codesList
    .filter((g) => g.product)
    .sort((a, b) => Number(b.byHand) - Number(a.byHand));
  const glossary = codesList.filter((g) => !g.product);
  const inArea = storesInArea(area, all, localDate());
  const codes = codeIndex(all.map((s) => ({ ...s, codes: storeCodes(s) })));
  const label = (s: (typeof all)[number]) =>
    s.chain === PLACE
      ? t('areaOf', { name: s.name })
      : [s.chainLabel, s.name].filter(Boolean).join(' ');
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
      <AutoRefresh on="post" />
      <Card>
        <CardHeader>
          <CardTitle>{t('posts')}</CardTitle>
          <CardDescription>
            {t('postsInfoPaged')}{' '}
            <Link href="/stores/area" className="underline">
              {t('inYourArea', { n: inArea.size })}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-1.5">
            <Link href="/stores" className={chip(!onlyArea)}>
              {t('allPosts')}
            </Link>
            <Link href="/stores?show=area" className={chip(onlyArea)}>
              {t('areaPosts')}
            </Link>
          </div>
          <PostsList
            key={`${onlyArea}|${first.posts[0]?.id ?? ''}`}
            initial={first.posts}
            more={first.more}
            onlyArea={onlyArea}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('codesTitle')}</CardTitle>
          <CardDescription>{t('codesInfo')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {codes.map((c) => (
                  <tr key={c.code} className="border-t align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{c.code}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {c.stores.map(label).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('productCodes')}</h3>
            <p className="text-xs text-muted-foreground">{t('productCodesInfo')}</p>
            {products.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noProductCodes')}</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {products.map((g) => (
                      <tr key={`${g.code}|${g.byHand}`} className="border-t align-top">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{g.code}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">
                          {g.meaning}
                          {!g.byHand && ` · ${t('fromFeed')}`}
                        </td>
                        <td className="py-1.5 text-right">
                          {user.role === 'admin' && g.byHand && <RemoveGlossary code={g.code} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('otherCodes')}</h3>
            {glossary.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noOtherCodes')}</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {glossary.map((g) => (
                    <tr key={`${g.code}|${g.byHand}`} className="border-t align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{g.code}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{g.meaning}</td>
                      <td className="py-1.5 text-right">
                        {user.role === 'admin' && g.byHand && <RemoveGlossary code={g.code} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {user.role === 'admin' && <AddGlossary />}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
