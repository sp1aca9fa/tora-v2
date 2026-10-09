'use client';

import { type Locale, PRODUCT_TYPES, type ProductType, displayName, unitCost } from '@tora/core';
import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useRef, useState } from 'react';
import { ConditionFields } from '@/components/condition-fields';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { ProductFields } from '@/components/product-fields';
import { ProductPicker } from '@/components/product-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatJpy } from '@/lib/utils';
import { type ProductSummary, createHoldingAction } from './actions';

const STEPS = ['what', 'how', 'details'] as const;

export function AddFlow({
  today,
  fromSuggestions,
  initialProduct,
}: {
  today: string;
  fromSuggestions: string[];
  initialProduct: ProductSummary | null;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [state, formAction, pending] = useActionState(createHoldingAction, {});
  const [step, setStep] = useState(initialProduct ? 1 : 0);
  const [mode, setMode] = useState<'existing' | 'new'>(initialProduct ? 'existing' : 'new');
  const [selected, setSelected] = useState<ProductSummary | null>(initialProduct);
  const [newType, setNewType] = useState<ProductType | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [cost, setCost] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const type = mode === 'existing' ? (selected?.type ?? null) : newType;

  function validateStep(): boolean {
    setStepError(null);
    const section = sectionRefs.current[step];
    for (const el of section?.querySelectorAll<HTMLInputElement>('input, select, textarea') ?? []) {
      if (!el.checkValidity()) {
        el.reportValidity();
        return false;
      }
    }
    if (step === 0) {
      if (mode === 'existing' && !selected) return fail('pickProduct');
      if (mode === 'new') {
        if (!newType) return fail('pickType');
        const value = (name: string) =>
          (formRef.current?.elements.namedItem(name) as HTMLInputElement | null)?.value.trim();
        if (!value('nameEn') && !value('nameJa')) return fail('nameRequired');
      }
    }
    return true;
  }

  function fail(key: string) {
    setStepError(key);
    return false;
  }

  function next() {
    if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const perUnit =
    Number(quantity) > 1 && cost
      ? unitCost(Number(cost.replace(/[^\d]/g, '')) || 0, Number(quantity))
      : null;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        // Enter in an early step moves forward instead of submitting.
        if (step < STEPS.length - 1) {
          e.preventDefault();
          next();
        }
      }}
      className="space-y-6"
    >
      <ol className="flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(
              'flex flex-1 items-center gap-1.5 border-t-2 pt-2',
              i <= step ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
            )}
          >
            {i < step ? <Check className="size-3.5" /> : <span>{i + 1}</span>}
            {t(`add.steps.${s}`)}
          </li>
        ))}
      </ol>

      <input type="hidden" name="mode" value={mode} />
      <input
        type="hidden"
        name="productId"
        value={mode === 'existing' ? (selected?.id ?? '') : ''}
      />

      {/* Step 1: what */}
      <section
        ref={(el) => {
          sectionRefs.current[0] = el;
        }}
        hidden={step !== 0}
        className="space-y-4"
      >
        <div className="grid grid-cols-3 gap-1 rounded-md border p-1 text-sm">
          {(['new', 'existing'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                'rounded px-2 py-1.5',
                mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {t(`add.mode.${m}`)}
            </button>
          ))}
          <button
            type="button"
            disabled
            title={t('add.sourceSearchSoon')}
            className="rounded px-2 py-1.5 text-muted-foreground/60"
          >
            {t('add.mode.source')}
          </button>
        </div>

        {mode === 'existing' &&
          (selected ? (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">{displayName(selected, locale)}</p>
                <p className="text-xs text-muted-foreground">{t(`productType.${selected.type}`)}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                {t('add.change')}
              </Button>
            </div>
          ) : (
            <ProductPicker onSelect={(p) => setSelected(p)} autoFocus />
          ))}

        {mode === 'new' && (
          <>
            <Field label={t('fields.type')}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRODUCT_TYPES.map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setNewType(pt)}
                    aria-pressed={newType === pt}
                    className={cn(
                      'rounded-md border px-2 py-2.5 text-sm',
                      newType === pt
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-accent',
                    )}
                  >
                    {t(`productType.${pt}`)}
                  </button>
                ))}
              </div>
              <input type="hidden" name="type" value={newType ?? ''} />
            </Field>
            {newType && <ProductFields key={newType} type={newType} />}
          </>
        )}
      </section>

      {/* Step 2: how I got it */}
      <section
        ref={(el) => {
          sectionRefs.current[1] = el;
        }}
        hidden={step !== 1}
        className="space-y-4"
      >
        {type && (
          <p className="text-sm text-muted-foreground">
            {mode === 'existing' && selected
              ? displayName(selected, locale)
              : t(`productType.${type}`)}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.acquiredAt')} htmlFor="acquiredAt">
            <Input
              id="acquiredAt"
              name="acquiredAt"
              type="date"
              required
              defaultValue={today}
              max={today}
            />
          </Field>
          <Field label={t('fields.acquiredFrom')} htmlFor="acquiredFrom">
            <Input
              id="acquiredFrom"
              name="acquiredFrom"
              list="from-suggestions"
              autoComplete="off"
            />
            <datalist id="from-suggestions">
              {fromSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label={t('fields.acquisitionType')} htmlFor="acquisitionType">
            <NativeSelect id="acquisitionType" name="acquisitionType" defaultValue="purchase">
              {(['purchase', 'gift', 'trade'] as const).map((a) => (
                <option key={a} value={a}>
                  {t(`acquisitionType.${a}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('fields.quantity')} htmlFor="quantity">
            <Input
              id="quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field
            label={t('fields.costTotalJpy')}
            htmlFor="costTotalJpy"
            hint={
              perUnit !== null
                ? t('common.perUnit', { amount: formatJpy(perUnit) })
                : t('add.costHint')
            }
            className="sm:col-span-2"
          >
            <Input
              id="costTotalJpy"
              name="costTotalJpy"
              inputMode="numeric"
              required
              pattern="[\d,¥￥\s]*"
              placeholder="¥"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </Field>
        </div>
      </section>

      {/* Step 3: condition details */}
      <section
        ref={(el) => {
          sectionRefs.current[2] = el;
        }}
        hidden={step !== 2}
        className="space-y-4"
      >
        {type && <ConditionFields key={type} type={type} />}
        <Field label={t('fields.notes')} htmlFor="notes">
          <Textarea id="notes" name="notes" rows={2} />
        </Field>
      </section>

      {stepError && (
        <p role="alert" className="text-sm text-destructive">
          {t(`add.errors.${stepError}`)}
        </p>
      )}
      <FormError state={state} />

      <div className="flex gap-2">
        {step > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep(step - 1)}
            className="flex-1 sm:flex-none"
          >
            {t('common.back')}
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          // Distinct keys: reusing one element would flip type=button to submit mid-click and submit.
          <Button key="next" type="button" onClick={next} className="flex-1 sm:flex-none">
            {t('common.next')}
          </Button>
        ) : (
          <Button key="submit" type="submit" disabled={pending} className="flex-1 sm:flex-none">
            {t('add.submit')}
          </Button>
        )}
      </div>
    </form>
  );
}
