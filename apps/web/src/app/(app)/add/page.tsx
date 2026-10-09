import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('add'))('title') };
}

export default async function AddPage() {
  const t = await getTranslations('add');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground">{t('comingSoon')}</p>
    </div>
  );
}
