'use client';

import type { SourceQuery } from '@tora/db';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type QueryFormState, updateQueryAction } from './source-actions';

/** Edits a search-based source's query (the words, excluded words and price range). */
export function QueryForm({ sourceId, query }: { sourceId: string; query: SourceQuery | null }) {
  const t = useTranslations('sources.search');
  const [state, formAction, pending] = useActionState<QueryFormState, FormData>(
    updateQueryAction.bind(null, sourceId),
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <Field label={t('keywords')} htmlFor={`q-${sourceId}`} hint={t('keywordsHint')}>
        <Input
          id={`q-${sourceId}`}
          name="keywords"
          required
          defaultValue={(query?.keywords ?? []).join(' ')}
        />
      </Field>
      <Field label={t('excludeWords')} htmlFor={`x-${sourceId}`} hint={t('excludeHint')}>
        <Input
          id={`x-${sourceId}`}
          name="excludeKeywords"
          defaultValue={(query?.excludeKeywords ?? []).join(' ')}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('priceMin')} htmlFor={`min-${sourceId}`}>
          <Input
            id={`min-${sourceId}`}
            name="priceMin"
            inputMode="numeric"
            placeholder="¥"
            defaultValue={query?.priceMin ?? ''}
          />
        </Field>
        <Field label={t('priceMax')} htmlFor={`max-${sourceId}`}>
          <Input
            id={`max-${sourceId}`}
            name="priceMax"
            inputMode="numeric"
            placeholder="¥"
            defaultValue={query?.priceMax ?? ''}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t('save')}
        </Button>
        {state.saved && <p className="text-xs text-muted-foreground">{t('saved')}</p>}
      </div>
      <FormError state={state} />
    </form>
  );
}
