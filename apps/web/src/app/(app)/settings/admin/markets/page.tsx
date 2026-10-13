import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MarketsSection } from './markets-section';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.markets.title') };
}

/** A market change rebuilds the value history after answering, within this time. */
export const maxDuration = 120;

export default function Page() {
  return <MarketsSection />;
}
