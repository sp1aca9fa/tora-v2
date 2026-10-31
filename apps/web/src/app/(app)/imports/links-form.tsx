'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useRef } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitWith } from '@/lib/submit-form';
import { type LinksState, addLinksAction } from './actions';

/** Paste links of things you bought (one per line); the home PC imports them on the next collect. */
export function LinksForm() {
  const t = useTranslations('imports.links');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<LinksState, FormData>(
    async (prev, formData) => {
      const next = await addLinksAction(prev, formData);
      if (next.added !== undefined) formRef.current?.reset();
      return next;
    },
    {},
  );
  return (
    <form ref={formRef} onSubmit={submitWith(formAction)} className="space-y-2">
      <Textarea name="links" required rows={3} placeholder="https://…" aria-label={t('label')} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('add')}
        </Button>
        {state.added !== undefined && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('added', { count: state.added })}
            {state.known ? ` · ${t('known', { count: state.known })}` : ''}
          </p>
        )}
        <FormError state={state} />
      </div>
    </form>
  );
}
