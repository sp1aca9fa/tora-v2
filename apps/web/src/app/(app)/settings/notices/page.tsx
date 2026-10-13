import { noticeLevelsFor } from '@tora/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { NoticeLevelsForm } from '../notice-levels-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.notices.title') };
}

export default async function NoticeSettingsPage() {
  const { user } = await authed();
  const t = await getTranslations();
  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('notices.title')}</CardTitle>
          <CardDescription>{t('notices.info')}</CardDescription>
        </CardHeader>
        <CardContent>
          <NoticeLevelsForm levels={noticeLevelsFor(user.noticeLevels)} />
        </CardContent>
      </Card>
    </div>
  );
}
