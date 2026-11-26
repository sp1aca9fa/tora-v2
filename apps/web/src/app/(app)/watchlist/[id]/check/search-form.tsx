'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { submitWith } from '@/lib/submit-form';
import { saveSearchAction } from '../../wish-actions';

/** The words one marketplace is searched with for the item, saved for everyone who wishes it. */
export function SearchForm({
  wishId,
  source,
  label,
  words,
  note,
}: {
  wishId: string;
  source: string;
  label: string;
  words: string;
  /** What the rules add when the search is sent; none: nothing. */
  note?: string;
}) {
  const t = useTranslations('wish.check');
  const [state, action, pending] = useActionState(saveSearchAction.bind(null, wishId, source), {});
  return (
    <form onSubmit={submitWith(action)} className="space-y-2">
      <Field label={label} htmlFor={`s-${source}`} hint={note}>
        <Input id={`s-${source}`} name="words" required maxLength={200} defaultValue={words} />
      </Field>
      <FormError state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {t('saveSearch')}
        </Button>
        {state.ok && <p className="text-xs text-muted-foreground">{t('searchSaved')}</p>}
      </div>
    </form>
  );
}
