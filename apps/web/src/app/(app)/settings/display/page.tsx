import { summaryPrefs } from '@tora/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { setAmountsVisibleAction } from '../actions';
import { SummaryForm } from '../summary-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.display.title') };
}

export default async function DisplaySettingsPage() {
  const { user } = await authed();
  const t = await getTranslations();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('amounts.title')}</CardTitle>
          <CardDescription>{t('amounts.info')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={setAmountsVisibleAction.bind(null, !user.preferences?.amountsVisible)}
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <span>
              {user.preferences?.amountsVisible
                ? t('amounts.alwaysShown')
                : t('amounts.hiddenFirst')}
            </span>
            <Button variant="outline" size="sm">
              {user.preferences?.amountsVisible ? t('amounts.makeHidden') : t('amounts.makeShown')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('summaryPrefs.title')}</CardTitle>
          <CardDescription>{t('summaryPrefs.info')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SummaryForm {...summaryPrefs(user.preferences)} />
        </CardContent>
      </Card>
    </div>
  );
}
