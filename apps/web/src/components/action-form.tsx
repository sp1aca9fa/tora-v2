'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import type { FormState } from '@/lib/form';

/**
 * Form shell for a server action: fields come in as (server-rendered) children; shows the
 * action's error and a pending state.
 */
export function ActionForm({
  action,
  submitLabel,
  cancelHref,
  destructive,
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  cancelHref: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations('common');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {children}
      <FormError state={state} />
      <div className="flex gap-2 pt-2">
        <Button
          type="submit"
          disabled={pending}
          variant={destructive ? 'destructive' : 'default'}
          className="flex-1 sm:flex-none"
        >
          {submitLabel}
        </Button>
        <Button asChild variant="outline" className="flex-1 sm:flex-none">
          <Link href={cancelHref}>{t('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
