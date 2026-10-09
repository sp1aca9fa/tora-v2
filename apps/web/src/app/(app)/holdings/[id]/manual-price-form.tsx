'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FormState } from '@/lib/form';

export function ManualPriceForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const t = useTranslations('valuation');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <Input
          name="priceJpy"
          inputMode="numeric"
          required
          placeholder="¥"
          aria-label={t('manualPrice')}
          className="max-w-40"
        />
        <Input name="note" placeholder={t('manualNote')} aria-label={t('manualNote')} />
        <Button type="submit" variant="outline" disabled={pending}>
          {t('setManual')}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}
