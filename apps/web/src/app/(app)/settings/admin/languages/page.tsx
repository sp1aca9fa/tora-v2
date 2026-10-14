import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LOCALES } from '@/i18n/locale';
import { adminOnly } from '@/lib/auth/guard';
import { getLanguages } from '@/lib/languages';
import { LanguagesForm } from '../../languages-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.languages.title') };
}

/** The app's languages (S16): the admin picks two of the installed translation files. */
export default async function LanguagesSettingsPage() {
  await adminOnly();
  const [languages, t] = await Promise.all([getLanguages(), getTranslations('languages')]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription className="space-y-2">
          <span className="block">{t('info')}</span>
          <span className="block">{t('add', { count: LOCALES.length })}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LanguagesForm
          installed={LOCALES}
          primary={languages.primary}
          secondary={languages.secondary}
        />
      </CardContent>
    </Card>
  );
}
