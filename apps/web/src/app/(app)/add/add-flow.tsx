'use client';

import {
  CATEGORIES,
  type Category,
  type ProductKind,
  type Region,
  SEALED_KINDS,
  TCG_FRANCHISES,
  type TcgFranchise,
  catalogProductName,
  kindsFor,
  productClass,
  regionsFor,
  unitCost,
} from '@tora/core';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useRef, useState } from 'react';
import { ConditionFields } from '@/components/condition-fields';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { ProductFields } from '@/components/product-fields';
import { ExistingSuggestions } from '@/components/existing-suggestions';
import { ProductPicker } from '@/components/product-picker';
import { SetPicker } from '@/components/set-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatJpy } from '@/lib/utils';
import { type ProductSummary, type SetSummary, createHoldingAction } from './actions';

const STEPS = ['what', 'how', 'details'] as const;
const MTG_VARIANTS = ['Play', 'Collector', 'Draft', 'Set', 'Jumpstart'];

function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
  columns = 'grid-cols-2 sm:grid-cols-4',
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  label: (v: T) => string;
  columns?: string;
}) {
  return (
    <div className={cn('grid gap-2', columns)}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className={cn(
            'rounded-md border px-2 py-2.5 text-sm',
            value === o ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
          )}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function AddFlow({
  today,
  fromSuggestions,
  franchiseSuggestions,
  initialProduct,
}: {
  today: string;
  fromSuggestions: string[];
  franchiseSuggestions: string[];
  initialProduct: ProductSummary | null;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(createHoldingAction, {});
  const [step, setStep] = useState(initialProduct ? 1 : 0);
  const [mode, setMode] = useState<'existing' | 'new'>(initialProduct ? 'existing' : 'new');
  const [selected, setSelected] = useState<ProductSummary | null>(initialProduct);
  // What is being typed for a new item, to suggest items already registered.
  const [typed, setTyped] = useState({ name: '', setCode: '', cardNumber: '' });
  const [category, setCategory] = useState<Category | null>(null);
  const [franchise, setFranchise] = useState<TcgFranchise | 'other' | null>(null);
  const [region, setRegion] = useState<Region>('jp');
  const [kind, setKind] = useState<ProductKind | null>(null);
  const [set, setSet] = useState<SetSummary | null>(null);
  const [manual, setManual] = useState(false);
  const [variant, setVariant] = useState('');
  const [name, setName] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [cost, setCost] = useState('');
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const isSealed = kind !== null && SEALED_KINDS.includes(kind);
  const hasCatalog = category === 'tcg' && franchise !== null && franchise !== 'other';
  const catalogMode = mode === 'new' && isSealed && hasCatalog && !manual;
  const submitMode = mode === 'existing' ? 'existing' : catalogMode ? 'catalog' : 'new';
  const cls =
    mode === 'existing'
      ? selected && productClass(selected)
      : category && kind && productClass({ category, kind });

  function reset(level: 'category' | 'franchise' | 'kind') {
    if (level === 'category') {
      setFranchise(null);
      setRegion('jp');
    }
    if (level !== 'kind') setKind(null);
    setSet(null);
    setManual(false);
    setVariant('');
  }

  function fail(key: string) {
    setStepError(key);
    return false;
  }

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
      if (mode === 'existing') return selected ? true : fail('pickProduct');
      if (!category) return fail('pickCategory');
      if (category === 'tcg' && !franchise) return fail('pickFranchise');
      if (!kind) return fail('pickKind');
      if (catalogMode && !set) return fail('pickSet');
    }
    return true;
  }

  function next() {
    if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const perUnit =
    Number(quantity) > 1 && cost
      ? unitCost(Number(cost.replace(/[^\d]/g, '')) || 0, Number(quantity))
      : null;

  const summary =
    mode === 'existing'
      ? selected?.name
      : catalogMode && set && kind
        ? catalogProductName(set.name, kind, variant)
        : name;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Enter in an early step moves forward instead of submitting.
        if (step < STEPS.length - 1) {
          e.preventDefault();
          next();
        }
      }}
      onChange={(e) => {
        const target = e.target as unknown as HTMLInputElement;
        if (target.name === 'name') setName(target.value);
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

      <input type="hidden" name="mode" value={submitMode} />
      <input
        type="hidden"
        name="productId"
        value={mode === 'existing' ? (selected?.id ?? '') : ''}
      />
      {catalogMode && (
        <>
          <input type="hidden" name="catalogSetId" value={set?.id ?? ''} />
          <input type="hidden" name="catalogKind" value={kind ?? ''} />
        </>
      )}

      {/* Step 1: what */}
      <section
        ref={(el) => {
          sectionRefs.current[0] = el;
        }}
        hidden={step !== 0}
        className="space-y-5"
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
                <p className="text-sm font-medium">{selected.name}</p>
                <p className="text-xs text-muted-foreground">{t(`kind.${selected.kind}`)}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                {t('add.change')}
              </Button>
            </div>
          ) : (
            <ProductPicker onSelect={setSelected} autoFocus />
          ))}

        {mode === 'new' && (
          <>
            <Field label={t('add.category')}>
              <Chips
                options={CATEGORIES}
                value={category}
                onChange={(c) => {
                  setCategory(c);
                  reset('category');
                }}
                label={(c) => t(`category.${c}`)}
                columns="grid-cols-2"
              />
              <input type="hidden" name="category" value={category ?? ''} />
            </Field>

            {category === 'tcg' && (
              <>
                <Field label={t('fields.franchise')}>
                  <Chips
                    options={[...TCG_FRANCHISES, 'other'] as const}
                    value={franchise}
                    onChange={(f) => {
                      setFranchise(f);
                      reset('franchise');
                    }}
                    label={(f) => t(`franchise.${f}`)}
                    columns="grid-cols-2 sm:grid-cols-5"
                  />
                  {franchise && franchise !== 'other' && (
                    <input type="hidden" name="franchise" value={franchise} />
                  )}
                </Field>
                {franchise === 'other' && (
                  <Field label={t('add.otherFranchise')} htmlFor="franchise">
                    <Input id="franchise" name="franchise" required list="tcg-franchises" />
                    <datalist id="tcg-franchises">
                      {franchiseSuggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </Field>
                )}
                {franchise && (
                  <Field label={t('fields.region')} htmlFor="region">
                    <NativeSelect
                      id="region"
                      name="region"
                      value={region}
                      onChange={(e) => {
                        setRegion(e.target.value as Region);
                        setSet(null);
                      }}
                    >
                      {regionsFor('tcg').map((r) => (
                        <option key={r} value={r}>
                          {t(`region.${r}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              </>
            )}

            {category && (category === 'game' || franchise) && (
              <Field label={t('fields.kind')}>
                <Chips
                  options={kindsFor(category)}
                  value={kind}
                  onChange={(k) => {
                    setKind(k);
                    reset('kind');
                  }}
                  label={(k) => t(`kind.${k}`)}
                />
                <input type="hidden" name="kind" value={kind ?? ''} />
              </Field>
            )}

            {catalogMode && kind && franchise && (
              <Field label={t('add.set')}>
                {set ? (
                  <div className="space-y-3 rounded-md border bg-muted/40 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {catalogProductName(set.name, kind, variant)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            set.code,
                            set.releaseDate && t('add.released', { date: set.releaseDate }),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSet(null)}>
                        {t('add.change')}
                      </Button>
                    </div>
                    {franchise === 'mtg' && (
                      <Field label={t('fields.variant')} htmlFor="catalogVariant">
                        <Input
                          id="catalogVariant"
                          name="catalogVariant"
                          list="mtg-variants"
                          value={variant}
                          onChange={(e) => setVariant(e.target.value)}
                          placeholder="Play / Collector"
                        />
                        <datalist id="mtg-variants">
                          {MTG_VARIANTS.map((v) => (
                            <option key={v} value={v} />
                          ))}
                        </datalist>
                      </Field>
                    )}
                  </div>
                ) : (
                  <SetPicker franchise={franchise} region={region} kind={kind} onSelect={setSet} />
                )}
                <button
                  type="button"
                  onClick={() => setManual(true)}
                  className="mt-1 text-sm text-muted-foreground underline"
                >
                  {t('add.notInList')}
                </button>
              </Field>
            )}

            {category && kind && !catalogMode && (
              <ProductFields
                onTyped={(field, value) => setTyped((v) => ({ ...v, [field]: value }))}
                key={`${category}-${kind}`}
                category={category}
                kind={kind}
                // For TCG, franchise and region are chosen above.
                franchiseInput={category === 'game'}
                showRegion={category === 'game'}
                franchiseSuggestions={franchiseSuggestions}
              />
            )}
            {category && kind && !catalogMode && (
              <ExistingSuggestions
                query={`${typed.name} ${typed.setCode} ${typed.cardNumber}`}
                category={category}
                kinds={[kind]}
                onSelect={(p) => {
                  setSelected(p);
                  setMode('existing');
                }}
              />
            )}
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
        {summary && <p className="text-sm font-medium">{summary}</p>}
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
          <Field
            label={t('fields.orderId')}
            htmlFor="orderId"
            hint={t('add.orderIdHint')}
            className="sm:col-span-2"
          >
            <Input id="orderId" name="orderId" autoComplete="off" inputMode="text" />
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
        {cls && <ConditionFields key={cls} cls={cls} />}
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
