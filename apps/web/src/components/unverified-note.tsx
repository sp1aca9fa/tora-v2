'use client';

import { useTranslations } from 'next-intl';
import { InfoTag } from '@/app/(app)/opportunities/info-tag';

/**
 * A game's cheaper ask from a search not yet checked for the game (S36 A2), as one muted line under
 * the price to act on: shown so it is not lost, never as a price to act on. A tap (phones have no
 * hover) opens why it is not used. `amount` is already formatted in the person's currency.
 */
export function UnverifiedNote({
  amount,
  source,
  align,
}: {
  amount: string;
  source: string;
  align?: 'start' | 'end';
}) {
  const t = useTranslations('askCheck');
  return (
    <InfoTag
      align={align}
      label={t.rich('also', {
        amount,
        source,
        // The number and the word stay together on a narrow phone column.
        k: (chunks) => <span className="whitespace-nowrap tabular-nums">{chunks}</span>,
      })}
      className="px-0 py-0 text-left font-normal text-muted-foreground"
    >
      <span className="block">{t('about')}</span>
    </InfoTag>
  );
}
