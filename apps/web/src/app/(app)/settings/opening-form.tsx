'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { clearOpeningRatesAction, saveOpeningRatesAction, setOpeningFeeAction } from './actions';

export interface OpeningRatesView {
  setId: string;
  name: string;
  code: string;
  packsPerBox: number;
  /** perBox as typed: "1/6", "0.2", "3". */
  tiers: { rarity: string; perBox: string; match: string }[];
  source: string;
  saved: boolean;
  /** A suggestion exists to go back to. */
  suggested: boolean;
  cards: number;
  readAt: string | null;
}

/** One set's pull rates (admins, S20). */
export function OpeningRatesForm({ view }: { view: OpeningRatesView }) {
  const t = useTranslations('opening');
  const [code, setCode] = useState(view.code);
  const [packs, setPacks] = useState(String(view.packsPerBox));
  const [tiers, setTiers] = useState(view.tiers);
  const [source, setSource] = useState(view.source);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edit = (i: number, part: Partial<OpeningRatesView['tiers'][number]>) =>
    setTiers(tiers.map((tier, j) => (j === i ? { ...tier, ...part } : tier)));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveOpeningRatesAction(view.setId, {
            code,
            packsPerBox: packs,
            tiers,
            source,
          });
          setError(result?.error ? t(`error.${result.error}`) : null);
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('code')}</span>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-9 w-28 font-mono"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('packs')}</span>
          <Input
            value={packs}
            inputMode="numeric"
            onChange={(e) => setPacks(e.target.value)}
            className="h-9 w-20"
          />
        </label>
        <label className="min-w-48 flex-1 space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('source')}</span>
          <Input value={source} onChange={(e) => setSource(e.target.value)} className="h-9" />
        </label>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[5rem_6rem_minmax(0,1fr)_2.25rem] gap-2 text-xs text-muted-foreground">
          <span>{t('rarity')}</span>
          <span>{t('perBoxInput')}</span>
          <span>{t('match')}</span>
        </div>
        {tiers.map((tier, i) => (
          <div key={i} className="grid grid-cols-[5rem_6rem_minmax(0,1fr)_2.25rem] gap-2">
            <Input
              value={tier.rarity}
              onChange={(e) => edit(i, { rarity: e.target.value })}
              className="h-9 font-mono"
              aria-label={t('rarity')}
            />
            <Input
              value={tier.perBox}
              onChange={(e) => edit(i, { perBox: e.target.value })}
              className="h-9"
              aria-label={t('perBoxInput')}
            />
            <Input
              value={tier.match}
              onChange={(e) => edit(i, { match: e.target.value })}
              className="h-9"
              aria-label={t('match')}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('removeTier')}
              onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setTiers([...tiers, { rarity: '', perBox: '', match: '' }])}
        >
          {t('addTier')}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('save')}
        </Button>
        {view.saved && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => startTransition(() => clearOpeningRatesAction(view.setId))}
          >
            {t(view.suggested ? 'useSuggested' : 'removeRates')}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {view.readAt
            ? t('cardsRead', { count: view.cards, date: view.readAt.slice(0, 10) })
            : t('cardsNotRead')}
        </span>
      </div>
    </form>
  );
}

const FEES = [0, 5, 8, 10, 12, 15, 20];

/** The selling fee taken off every card's price (admins, S20), in percent. */
export function OpeningFeeForm({ percent }: { percent: number }) {
  const t = useTranslations('opening');
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      {t('fee')}
      <NativeSelect
        value={percent}
        disabled={pending}
        onChange={(e) => startTransition(() => setOpeningFeeAction(Number(e.target.value)))}
        className="h-9 w-24"
      >
        {[...new Set([...FEES, percent])]
          .sort((a, b) => a - b)
          .map((p) => (
            <option key={p} value={p}>
              {p}%
            </option>
          ))}
      </NativeSelect>
    </label>
  );
}
