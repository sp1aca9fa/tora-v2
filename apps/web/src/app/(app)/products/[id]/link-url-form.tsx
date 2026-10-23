'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FormState } from '@/lib/form';

/** `label`: the sentence shown above the box, with its source names filled in. */
export function LinkUrlForm({
  action,
  label,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  label: string;
}) {
  const t = useTranslations('sources');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <Input
          name="url"
          type="url"
          inputMode="url"
          required
          placeholder="https://…"
          aria-label={label}
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {t('link')}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}
