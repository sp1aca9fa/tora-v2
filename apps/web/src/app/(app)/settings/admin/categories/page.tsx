import { categoryUsage, getDb } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { getLanguages } from '@/lib/languages';
import { getTaxonomy } from '@/lib/taxonomy';
import { CategoriesForm } from '../../categories-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.categories.title') };
}

/** A change rebuilds the value history after answering, within this time. */
export const maxDuration = 120;

/** The admin's categories, kinds, fields and condition lists (S16 part 3). */
export default async function CategoriesSettingsPage() {
  await adminOnly();
  const [taxonomy, usage, languages, t] = await Promise.all([
    getTaxonomy(),
    categoryUsage(getDb()),
    getLanguages(),
    getTranslations('categories'),
  ]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription className="space-y-2">
          <span className="block">{t('info')}</span>
          <span className="block">{t('plugins')}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CategoriesForm
          taxonomy={taxonomy}
          usage={usage}
          languages={[languages.primary, ...(languages.secondary ? [languages.secondary] : [])]}
        />
      </CardContent>
    </Card>
  );
}
