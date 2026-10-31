import { PLACE, codeIndex } from '@tora/core';
import { cachedStores, storeCodes, storeGlossary } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import {
  AddGlossary,
  AddStoreForm,
  HideGlossary,
  RemoveGlossary,
  StoreCodesList,
} from '../store-area';
import { storeViews } from '../store-views';

/**
 * What the codes posters use stand for (S25): stores' and places', products', others'. Admins
 * change each store's codes and add stores and places here.
 */
export default async function StoreCodesPage() {
  const { db, user } = await authed();
  const admin = user.role === 'admin';
  const [t, all, codesList, views] = await Promise.all([
    getTranslations('stores'),
    cachedStores(db),
    storeGlossary(db, true),
    admin ? storeViews(db) : null,
  ]);
  // The admins' product codes first (they win over the board's list's); turned off ones last.
  const listed = codesList.filter((g) => admin || !g.hidden);
  const products = listed
    .filter((g) => g.product)
    .sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden) || Number(b.byHand) - Number(a.byHand));
  const glossary = listed.filter((g) => !g.product);
  /** Remove (an admin's code) or turn off / on (a store list's or feed's). */
  const change = (g: (typeof codesList)[number]) =>
    admin &&
    (g.byHand ? (
      <RemoveGlossary code={g.code} />
    ) : (
      <HideGlossary code={g.code} hidden={!!g.hidden} />
    ));
  const codes = codeIndex(all.map((s) => ({ ...s, codes: storeCodes(s) })));
  const label = (s: (typeof all)[number]) =>
    s.chain === PLACE
      ? t('areaOf', { name: s.name })
      : [s.chainLabel, s.name].filter(Boolean).join(' ');

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
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
                    <td className="w-px py-1.5 pr-3 whitespace-nowrap">{c.code}</td>
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
                      <tr
                        key={`${g.code}|${g.byHand}`}
                        className={cn('border-t align-top', g.hidden && 'opacity-60')}
                      >
                        <td className="w-px py-1.5 pr-3 whitespace-nowrap">{g.code}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">
                          {g.meaning}
                          {!g.byHand && ` · ${t('fromFeed')}`}
                          {g.hidden && ` · ${t('codeIsOff')}`}
                        </td>
                        <td className="py-1.5 text-right">{change(g)}</td>
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
                    <tr
                      key={`${g.code}|${g.byHand}`}
                      className={cn('border-t align-top', g.hidden && 'opacity-60')}
                    >
                      <td className="w-px py-1.5 pr-3 whitespace-nowrap">{g.code}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        {g.meaning}
                        {g.chain && ` · ${t('chainCode')}`}
                        {g.lottery && ` · ${t('codeKindLottery')}`}
                        {g.notLottery && ` · ${t('codeKindNotLottery')}`}
                        {g.hidden && ` · ${t('codeIsOff')}`}
                      </td>
                      <td className="py-1.5 text-right">{change(g)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {admin && <AddGlossary />}
          </div>
        </CardContent>
      </Card>
      {views && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('storeCodesTitle')}</CardTitle>
              <CardDescription>{t('codesEdit')}</CardDescription>
            </CardHeader>
            <CardContent>
              <StoreCodesList stores={views} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('addTitle')}</CardTitle>
              <CardDescription>{t('addInfo')}</CardDescription>
            </CardHeader>
            <CardContent>
              <AddStoreForm
                chains={[
                  ...new Map(all.map((s) => [s.chain, s.chainLabel ?? s.chain])).entries(),
                ].map(([chain, label]) => ({ chain, label }))}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
