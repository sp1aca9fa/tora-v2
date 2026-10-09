'use client';

import { useTranslations } from 'next-intl';
import type { FormState } from '@/lib/form';

export function FormError({ state }: { state: FormState }) {
  const t = useTranslations();
  if (!state.error) return null;
  const fields = state.fields?.map((f) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f));
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t('errors.unknown')}
      {fields?.length ? `: ${fields.join(', ')}` : null}
    </p>
  );
}
