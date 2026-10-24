import { accountIsEmpty } from '@tora/db';
import { Download, FileJson, FileSpreadsheet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { LoadAccount } from './load-account';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.data.title') };
}

/**
 * Download my data (requirements S6): the account's lots as a spreadsheet, and all of it as JSON;
 * an empty account can load such a JSON file (S15).
 */
export default async function DataSettingsPage() {
  const { db, user } = await authed();
  const [t, empty] = await Promise.all([getTranslations('myData'), accountIsEmpty(db, user.id)]);
  const download = (href: string, label: string) => (
    <Button asChild size="sm" variant="outline">
      {/* A file, not a page: a plain link the browser downloads. */}
      <a href={href} download>
        <Download className="size-4" />
        {label}
      </a>
    </Button>
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4" />
            {t('lotsTitle')}
          </CardTitle>
          <CardDescription>{t('lotsInfo')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {download('/export/lots', t('lotsDownload'))}
          <p className="text-muted-foreground">
            {t.rich('lotsImport', {
              link: (chunks) => (
                <Link href="/imports#sheet" className="underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="size-4" />
            {t('allTitle')}
          </CardTitle>
          <CardDescription>{t('allInfo')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {download('/export/account', t('allDownload'))}
          {/* Into an empty account only: a new one, or one moved from another install. */}
          {empty && <LoadAccount />}
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        {t('noPrices')}
        {user.role === 'admin' && ` ${t('adminBackups')}`}
      </p>
    </div>
  );
}
