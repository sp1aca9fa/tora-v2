'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { useTaxonomy } from '@/components/taxonomy-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { submitWith } from '@/lib/submit-form';
import { type GameState, addGameWishAction } from '../wish-actions';

export interface ConsoleChoice {
  key: string;
  name: string;
  boxedAllowed: boolean;
}

/**
 * One new game for the wishlist (S36 B1): its name, console (from the console table), region (Japan
 * unless picked), an optional edition and, for a console that allows it, boxed. Nothing is fetched:
 * the check page shows what the next nightly read finds.
 */
export function GameForm({ consoles }: { consoles: ConsoleChoice[] }) {
  const t = useTranslations();
  const taxonomy = useTaxonomy();
  const [state, action, pending] = useActionState<GameState, FormData>(addGameWishAction, {});
  const found = state.lookAlikes ?? [];
  const [console, setConsole] = useState(consoles[0]?.key ?? '');
  const regions = taxonomy.categories.find((c) => c.key === 'game')?.regions ?? ['jp'];
  const boxedAllowed = consoles.find((c) => c.key === console)?.boxedAllowed ?? false;
  if (!consoles.length)
    return <p className="text-sm text-muted-foreground">{t('wish.game.noConsoles')}</p>;
  return (
    <form onSubmit={submitWith(action)} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('wish.game.intro')}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label={t('wish.game.name')} htmlFor="g-name" className="sm:col-span-2 xl:col-span-1">
          <Input id="g-name" name="name" required maxLength={200} autoComplete="off" />
        </Field>
        <Field label={t('wish.game.console')} htmlFor="g-console">
          <NativeSelect
            id="g-console"
            name="console"
            value={console}
            onChange={(e) => setConsole(e.target.value)}
          >
            {consoles.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('wish.game.region')} htmlFor="g-region">
          <NativeSelect
            id="g-region"
            name="region"
            defaultValue={regions.includes('jp') ? 'jp' : regions[0]}
          >
            {regions.map((r) => (
              <option key={r} value={r}>
                {t.has(`region.${r}`) ? t(`region.${r}`) : r}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('wish.game.edition')} htmlFor="g-edition" hint={t('wish.game.editionHint')}>
          <Input id="g-edition" name="edition" maxLength={80} autoComplete="off" />
        </Field>
        <Field label={t('watchlist.target')} htmlFor="g-target" hint={t('watchlist.targetHint')}>
          <Input id="g-target" name="targetPriceBase" inputMode="decimal" autoComplete="off" />
        </Field>
      </div>
      {boxedAllowed && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="boxed" className="mt-1 size-4" />
          <span>
            {t('wish.game.boxed')}
            <span className="block text-xs text-muted-foreground">{t('wish.game.boxedHint')}</span>
          </span>
        </label>
      )}
      {found.length > 0 && (
        // A game already in Tora (fix C2): reused by default when it is the only one, so its sales
        // and listings are not read twice under two items.
        <fieldset className="max-w-3xl space-y-2 rounded-lg border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/40">
          <legend className="px-1 font-medium">{t('wish.game.found')}</legend>
          {found.map((a) => (
            <label key={a.id} className="flex items-start gap-2">
              <input
                type="radio"
                name="choice"
                value={a.id}
                required
                defaultChecked={found.length === 1}
                className="mt-1"
              />
              <span>
                {t('wish.bulk.reuse', { name: a.name })}
                {a.wished && (
                  <span className="text-muted-foreground"> ({t('wish.bulk.wished')})</span>
                )}
              </span>
            </label>
          ))}
          <label className="flex items-start gap-2">
            <input type="radio" name="choice" value="new" required className="mt-1" />
            <span>
              {t('wish.bulk.new')}
              <span className="block text-xs text-muted-foreground">{t('wish.game.newHint')}</span>
            </span>
          </label>
        </fieldset>
      )}
      <FormError state={state} />
      <Button type="submit" disabled={pending}>
        {t('wish.game.submit')}
      </Button>
    </form>
  );
}
