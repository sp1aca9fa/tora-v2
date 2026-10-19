import { PLACE, codeIndex, localDate, storesInArea } from '@tora/core';
import { listStores, recentPosts, storeCodes, storeGlossary } from '@tora/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { AddGlossary, RemoveGlossary } from './store-area';
import { AutoRefresh } from './stores-nav';

/**
 * Store notices, the main sub page (S25): the latest posts, the area's first, and what the codes
 * posters use stand for. Before an area is set, the Area page comes first.
 */
export default async function StorePostsPage() {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const [t, all, posts, glossary] = await Promise.all([
    getTranslations('stores'),
    listStores(db),
    recentPosts(db, 60),
    storeGlossary(db),
  ]);
  const inArea = storesInArea(area, all, localDate());
  const byId = new Map(all.map((s) => [s.id, s]));
  const codes = codeIndex(all.map((s) => ({ ...s, codes: storeCodes(s) })));
  const label = (s: (typeof all)[number]) =>
    s.chain === PLACE
      ? t('areaOf', { name: s.name })
      : [s.chainLabel, s.name].filter(Boolean).join(' ');
  const sorted = [...posts].sort(
    (a, b) =>
      Number(b.storeIds.some((id) => inArea.has(id))) -
        Number(a.storeIds.some((id) => inArea.has(id))) || b.postedAt.localeCompare(a.postedAt),
  );

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
      <AutoRefresh />
      <Card>
        <CardHeader>
          <CardTitle>{t('posts')}</CardTitle>
          <CardDescription>
            {t('postsInfo')}{' '}
            <Link href="/stores/area" className="underline">
              {t('inYourArea', { n: inArea.size })}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noPosts')}</p>
          ) : (
            <ul className="divide-y text-sm">
              {sorted.slice(0, 40).map((p) => {
                const mine = p.storeIds.some((id) => inArea.has(id));
                const names = p.storeIds
                  .map((id) => byId.get(id))
                  .filter((s) => !!s)
                  .map(label);
                return (
                  <li key={p.id} className={cn('space-y-0.5 py-2', !mine && 'opacity-70')}>
                    <p className="text-xs text-muted-foreground">
                      {p.postedAt.slice(5, 16).replace('T', ' ')}
                      {p.author ? ` · ${p.author}` : ''} ·{' '}
                      <span className={cn(mine && 'font-semibold text-foreground')}>
                        {names.length ? names.join(', ') : t('unknownStore')}
                      </span>
                    </p>
                    <p className="break-words">
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {p.text}
                        </a>
                      ) : (
                        p.text
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
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
