'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { submitWith } from '@/lib/submit-form';
import { saveRulesAction } from '../../wish-actions';

/** The item's words and edition (S36 B1), saved for everyone who wishes it. */
export function RulesForm({
  wishId,
  edition,
  required,
  excluded,
}: {
  wishId: string;
  edition: string;
  required: readonly string[];
  excluded: readonly string[];
}) {
  const t = useTranslations('wish.check');
  const tg = useTranslations('wish.game');
  const [state, action, pending] = useActionState(saveRulesAction.bind(null, wishId), {});
  return (
    <form onSubmit={submitWith(action)} className="space-y-3">
      <Field label={t('required')} htmlFor="r-required" hint={t('wordsHint')}>
        <Textarea id="r-required" name="required" rows={2} defaultValue={required.join('\n')} />
      </Field>
      <Field label={t('excluded')} htmlFor="r-excluded">
        <Textarea id="r-excluded" name="excluded" rows={2} defaultValue={excluded.join('\n')} />
      </Field>
      <Field label={tg('edition')} htmlFor="r-edition">
        <Input id="r-edition" name="edition" maxLength={80} defaultValue={edition} />
      </Field>
      <FormError state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t('saveRules')}
      </Button>
    </form>
  );
}
