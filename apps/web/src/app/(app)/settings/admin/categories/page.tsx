import { categoryUsage, getDb, setLineList } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { getLanguages } from '@/lib/languages';
import { getTaxonomy } from '@/lib/taxonomy';
import { CategoriesForm } from '../../categories-form';
import { SetLinesForm } from '../../set-lines-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.categories.title') };
}

/** A change rebuilds the value history after answering, within this time. */
export const maxDuration = 120;

/** The admin's categories, kinds, fields and condition lists (S16 part 3). */
export default async function CategoriesSettingsPage() {
  await adminOnly();
  const [taxonomy, usage, languages, lines, t, tl] = await Promise.all([
    getTaxonomy(),
    categoryUsage(getDb()),
    getLanguages(),
    setLineList(getDb()),
    getTranslations('categories'),
    getTranslations('setLines'),
  ]);
  return (
    <div className="space-y-6">
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
      <Card>
        <CardHeader>
          <CardTitle>{tl('title')}</CardTitle>
          <CardDescription>{tl('info')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetLinesForm lines={lines} />
        </CardContent>
      </Card>
    </div>
  );
}
