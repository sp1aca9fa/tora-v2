'use client';

import {
  type Category,
  type ProductKind,
  type Region,
  SEALED_KINDS,
  TCG_FRANCHISES,
  type TcgFranchise,
  catalogProductName,
  categoryDef,
  itemTypeOf,
  productClass,
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
import { useTaxonomy } from '@/components/taxonomy-context';
import { SetPicker } from '@/components/set-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { type ProductSummary, type SetSummary, createHoldingAction } from './actions';
import { createWatchAction } from '../watchlist/actions';
import { useMoney } from '@/components/money-context';

const LOT_STEPS = ['what', 'how', 'details'] as const;
/** Watching an item (S9): what, then the condition and target. */
const WATCH_STEPS = ['what', 'watch'] as const;
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

/** Product fields remembered across category / kind switches. */
const DRAFT_FIELDS = new Set([
  'name',
  'setName',
  'setCode',
  'cardNumber',
  'rarity',
  'variant',
  'releaseDate',
  'retailPriceBase',
  'platform',
  'franchise',
  'notes',
]);

export function AddFlow({
  today,
  fromSuggestions,
  franchiseSuggestions,
  initialProduct,
  fromLink,
  watch = false,
}: {
  today: string;
  fromSuggestions: string[];
  franchiseSuggestions: string[];
  initialProduct: ProductSummary | null;
  /** Adding a purchase link that could not be imported: shop and order ID prefilled. */
  fromLink?: {
    id: string;
    url: string;
    acquiredFrom: string | null;
    orderId: string | null;
  } | null;
  /** Watch the item instead of registering a lot (S9). */
  watch?: boolean;
}) {
  const money = useMoney();
  const t = useTranslations();
  const STEPS: readonly string[] = watch ? WATCH_STEPS : LOT_STEPS;
  const [state, formAction, pending] = useActionState(
    watch ? createWatchAction : createHoldingAction,
    {},
  );
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
  // Product details typed so far: kept when switching category or kind and coming back.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [acquiredAt, setAcquiredAt] = useState(today);
  const [onRelease, setOnRelease] = useState(false);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const taxonomy = useTaxonomy();
  const def = category ? categoryDef(taxonomy, category) : undefined;
  // TCG (S16: a category with the set catalog) picks its franchise and region first.
  const catalog = !!def?.setCatalog;
  const isSealed = kind !== null && (SEALED_KINDS as readonly string[]).includes(kind);
  const hasCatalog = catalog && franchise !== null && franchise !== 'other';
  const catalogMode = mode === 'new' && isSealed && hasCatalog && !manual;
  const submitMode = mode === 'existing' ? 'existing' : catalogMode ? 'catalog' : 'new';
  const cls =
    mode === 'existing'
      ? selected && productClass(selected)
      : category &&
        kind &&
        (itemTypeOf(taxonomy, category, kind) ?? productClass({ category, kind }));

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
      if (catalog && !franchise) return fail('pickFranchise');
      if (!kind) return fail('pickKind');
      if (catalogMode && !set) return fail('pickSet');
    }
    return true;
  }

  function next() {
    if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  // A full release date of the item (typed, of the chosen product, or of the catalog set).
  const releaseDate = [
    mode === 'existing'
      ? selected?.releaseDate
      : catalogMode
        ? set?.releaseDate
        : draft.releaseDate,
  ].find((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today);
  const retail =
    mode === 'existing'
      ? (selected?.retailPriceBase ?? null)
      : catalogMode
        ? null
        : money.parse(draft.retailPriceBase) || null;

  const perUnit =
    Number(quantity) > 1 && cost ? unitCost(money.parse(cost) ?? 0, Number(quantity)) : null;

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
        if (DRAFT_FIELDS.has(target.name)) {
          setDraft((d) => ({ ...d, [target.name]: target.value }));
        }
      }}
      className="space-y-6"
    >
      {fromLink && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {t('add.fromLink')}{' '}
          <a href={fromLink.url} target="_blank" rel="noreferrer" className="break-all underline">
            {fromLink.url.replace(/^https?:\/\//, '')}
          </a>
        </p>
      )}
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
            {t(watch && s === 'watch' ? 'watchlist.step' : `add.steps.${s}`)}
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
                options={taxonomy.categories.filter((c) => !c.hidden).map((c) => c.key)}
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

            {catalog && (
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
                      {(def?.regions ?? []).map((r) => (
                        <option key={r} value={r}>
                          {t(`region.${r}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              </>
            )}

            {category && (!catalog || franchise) && (
              <Field label={t('fields.kind')}>
                <Chips
                  options={(def?.kinds ?? []).filter((k) => !k.hidden).map((k) => k.key)}
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
                franchiseInput={!catalog}
                showRegion={!catalog}
                franchiseSuggestions={franchiseSuggestions}
                defaults={draft}
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

      {watch && (
        <section
          ref={(el) => {
            sectionRefs.current[1] = el;
          }}
          hidden={step !== 1}
          className="space-y-4"
        >
          {summary && <p className="text-sm font-medium">{summary}</p>}
          <p className="text-sm text-muted-foreground">{t('watchlist.conditionHint')}</p>
          {cls && <ConditionFields key={cls} cls={cls} />}
          <WatchTargetFields retail={retail} />
        </section>
      )}

      {/* Step 2: how I got it */}
      {!watch && (
        <section
          ref={(el) => {
            sectionRefs.current[1] = el;
          }}
          hidden={step !== 1}
          className="space-y-4"
        >
          {summary && <p className="text-sm font-medium">{summary}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('fields.acquiredAt')} htmlFor="acquiredAt">
              <Input
                id="acquiredAt"
                name="acquiredAt"
                type="date"
                required
                value={acquiredAt}
                onChange={(e) => {
                  setAcquiredAt(e.target.value);
                  setOnRelease(false);
                }}
                max={today}
              />
              <label
                className={cn(
                  'mt-1.5 flex items-center gap-2 text-xs',
                  releaseDate ? 'text-muted-foreground' : 'text-muted-foreground/50',
                )}
              >
                <input
                  type="checkbox"
                  className="size-3.5"
                  disabled={!releaseDate}
                  checked={onRelease && !!releaseDate}
                  onChange={(e) => {
                    setOnRelease(e.target.checked);
                    setAcquiredAt(e.target.checked && releaseDate ? releaseDate : today);
                  }}
                />
                {releaseDate
                  ? t('add.onRelease', { date: releaseDate })
                  : t('add.onReleaseUnknown')}
              </label>
            </Field>
            <Field label={t('fields.acquiredFrom')} htmlFor="acquiredFrom">
              <Input
                id="acquiredFrom"
                name="acquiredFrom"
                list="from-suggestions"
                autoComplete="off"
                defaultValue={fromLink?.acquiredFrom ?? undefined}
              />
              <datalist id="from-suggestions">
                <option value={t('add.unknownFrom')} />
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
              label={t('fields.costTotalBase')}
              htmlFor="costTotalBase"
              hint={
                !cost.trim() && retail
                  ? t('add.costFromRetail', {
                      amount: money(retail * (Number(quantity) || 1)),
                    })
                  : perUnit !== null
                    ? t('common.perUnit', { amount: money(perUnit) })
                    : t('add.costHint')
              }
              className="sm:col-span-2"
            >
              <Input
                id="costTotalBase"
                name="costTotalBase"
                inputMode="decimal"
                required={!retail}
                placeholder={money.symbol}
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
              <Input
                id="orderId"
                name="orderId"
                autoComplete="off"
                inputMode="text"
                defaultValue={fromLink?.orderId ?? undefined}
              />
              {fromLink && <input type="hidden" name="purchaseLinkId" value={fromLink.id} />}
            </Field>
          </div>
        </section>
      )}

      {/* Step 3: condition details */}
      {!watch && (
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
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {t('tracking.title')}
            </summary>
            <div className="mt-2 space-y-2">
              <input type="hidden" name="tracking" value="shown" />
              <p className="text-xs text-muted-foreground">{t('tracking.info')}</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="countInCost" defaultChecked className="size-4" />
                {t('tracking.inCost')}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="countInValue" defaultChecked className="size-4" />
                {t('tracking.inValue')}
              </label>
            </div>
          </details>
        </section>
      )}

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
            {t(watch ? 'watchlist.submit' : 'add.submit')}
          </Button>
        )}
      </div>
    </form>
  );
}

/** A watch's target price and note (S9), shared by the watch steps and the item page's card. */
export function WatchTargetFields({
  retail,
  defaults = {},
}: {
  retail?: number | null;
  defaults?: { target?: number | null; note?: string | null };
}) {
  const t = useTranslations();
  const money = useMoney();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label={t('watchlist.target')}
        htmlFor="w-target"
        hint={
          retail
            ? t('watchlist.targetHintRetail', { amount: money(retail) })
            : t('watchlist.targetHint')
        }
      >
        <Input
          id="w-target"
          name="targetPriceBase"
          inputMode="decimal"
          placeholder={money.symbol}
          defaultValue={defaults.target != null ? money.input(defaults.target) : undefined}
        />
      </Field>
      <Field label={t('fields.notes')} htmlFor="w-note">
        <Textarea id="w-note" name="note" rows={2} defaultValue={defaults.note ?? undefined} />
      </Field>
    </div>
  );
}
