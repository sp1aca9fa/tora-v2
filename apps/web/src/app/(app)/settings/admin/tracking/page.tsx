import { DEFAULT_TRACKING_HOURS } from '@tora/core';
import { readTracking } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { TrackingForm } from './tracking-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.tracking.title') };
}

/** The board tracker's working hours (S25, admins): when store feeds read their boards. */
export default async function TrackingSettingsPage() {
  const { db } = await adminOnly();
  const [{ hours }, t] = await Promise.all([readTracking(db), getTranslations('boardTracking')]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info')}</CardDescription>
      </CardHeader>
      <CardContent>
        <TrackingForm hours={hours} defaults={DEFAULT_TRACKING_HOURS} />
      </CardContent>
    </Card>
  );
}
