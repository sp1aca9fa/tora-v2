import { appTimeZone, offsetText, zoneOffset } from '@tora/core';
import { loadTimeZone, storedTimes } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { TimeZoneForm } from '../../time-zone-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.timeZone.title') };
}

/** The app's time zone (S16 part 5): what a day is, and the offset stored times carry. */
export default async function TimeZoneSettingsPage() {
  const { db } = await adminOnly();
  const [current, stored, t] = await Promise.all([
    loadTimeZone(db),
    storedTimes(db),
    getTranslations('timeZone'),
  ]);
  const now = new Date();
  const zones = [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', appTimeZone()])]
    .sort()
    .map((name) => ({ name, offset: `UTC${offsetText(zoneOffset(now, name))}` }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info')}</CardDescription>
      </CardHeader>
      <CardContent>
        <TimeZoneForm current={current} zones={zones} stored={stored} />
      </CardContent>
    </Card>
  );
}
