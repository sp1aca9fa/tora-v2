import { localeFor } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { alertContext } from '@/lib/alerts';
import { authed } from '@/lib/auth/guard';
import { NoticeStyler } from './notice-styler';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.alertStyle.title') };
}

/**
 * Customize notices: every kind of message Tora sends to Discord and Telegram, with examples, and
 * the person's own look and wording for each (in their notice language).
 */
export default async function AlertStylePage() {
  const { db, user } = await authed();
  const ctx = alertContext();
  const [t, locale] = await Promise.all([getTranslations('alertStyle'), localeFor(db, user)]);
  const base = ctx ? { ...(await ctx.texts('en')), ...(await ctx.texts(locale)) } : {};
  const prefs = user.preferences?.notices;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info')}</CardDescription>
      </CardHeader>
      <CardContent>
        <NoticeStyler base={base} own={prefs?.texts?.[locale] ?? {}} styles={prefs?.styles ?? {}} />
      </CardContent>
    </Card>
  );
}
