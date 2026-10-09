'use client';

import { type Locale, RAW_GRADES, displayName } from '@tora/core';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { ProductSummary } from '@/app/(app)/add/actions';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { ProductPicker } from '@/components/product-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { PullState } from '../actions';

/**
 * Rapid entry: pick an existing card or type a new name, grade defaults to A, add, repeat.
 * The form resets after each add and focus returns to the name box.
 */
export function PullLogger({
  action,
  today,
}: {
  action: (state: PullState, formData: FormData) => Promise<PullState>;
  today: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [existing, setExisting] = useState<ProductSummary | null>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: PullState, formData: FormData) => {
      const next = await action(prev, formData);
      if (next.added !== prev.added) setExisting(null);
      return next;
    },
    {},
  );
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.added) nameRef.current?.focus();
  }, [state.added]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="date" value={today} />
      <input type="hidden" name="productId" value={existing?.id ?? ''} />

      <div className="inline-flex rounded-md border p-0.5 text-sm">
        {(['new', 'existing'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setExisting(null);
            }}
            aria-pressed={mode === m}
            className={
              mode === m
                ? 'rounded bg-primary px-3 py-1 text-primary-foreground'
                : 'px-3 py-1 text-muted-foreground'
            }
          >
            {t(`pulls.mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === 'new' ? (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label={t('pulls.name')} htmlFor="pull-name" hint={t('pulls.nameHint')}>
            <Input id="pull-name" ref={nameRef} name="name" required autoFocus autoComplete="off" />
          </Field>
          <Field label={t('fields.cardNumber')} htmlFor="pull-number">
            <Input id="pull-number" name="cardNumber" autoComplete="off" placeholder="123/100" />
          </Field>
          <Field label={t('fields.rarity')} htmlFor="pull-rarity">
            <Input id="pull-rarity" name="rarity" autoComplete="off" placeholder="SAR" />
          </Field>
        </div>
      ) : existing ? (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{displayName(existing, locale)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setExisting(null)}
            aria-label={t('add.change')}
          >
            <X />
          </Button>
        </div>
      ) : (
        <ProductPicker types={['card_single']} onSelect={setExisting} autoFocus />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('fields.rawGrade')} htmlFor="pull-grade">
          <NativeSelect id="pull-grade" name="rawGrade" defaultValue="A">
            {RAW_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('fields.quantity')} htmlFor="pull-qty">
          <Input
            id="pull-qty"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={1}
            required
          />
        </Field>
      </div>

      <FormError state={state} />
      <Button
        type="submit"
        disabled={pending || (mode === 'existing' && !existing)}
        className="w-full sm:w-auto"
      >
        {t('pulls.add')}
      </Button>
    </form>
  );
}
