'use client';

import {
  ITEM_CONDITION_BUCKETS,
  ITEM_FACT_KINDS,
  WISH_CONDITIONS,
  WISH_ESTIMATE_BASES,
  WISH_RISKS,
  wishConditionOf,
} from '@tora/core';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { useMoney } from '@/components/money-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { bucketLabel } from '@/lib/product-display';
import { submitWith } from '@/lib/submit-form';
import {
  type WishFormState,
  addEstimateAction,
  recordFactAction,
  setConditionAction,
  setTargetAction,
} from './actions';

type Bound = (prev: WishFormState, formData: FormData) => Promise<WishFormState>;

/** A form driven by its action's state; `key` changes on a save, so an add-form remounts empty. */
function useWishForm(action: Bound) {
  const [state, formAction, pending] = useActionState<WishFormState, FormData>(action, {});
  return { state, pending, key: state.saved ?? 0, onSubmit: submitWith(formAction) };
}

function Saved({ state }: { state: WishFormState }) {
  const t = useTranslations();
  return state.saved && !state.error ? (
    <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
      {t('wish.page.saved')}
    </p>
  ) : null;
}

/** A form's button with what its last save did (saved, or the error) right beside it (item 16). */
function SaveRow({
  state,
  pending,
  label,
  variant = 'outline',
}: {
  state: WishFormState;
  pending: boolean;
  label: string;
  variant?: 'outline' | 'default';
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
      <FormError state={state} />
      <Saved state={state} />
    </div>
  );
}

/**
 * The wish's price (the watch target) and its condition, two forms side by side when they fit (from
 * the phone up), each input at its natural width (fix round 2, item 7). The select
 * shows the stored condition's bucket (a stored damaged or poor shows as fair; saving it unchanged
 * keeps it); a wish with no condition shows "Choose a condition" (fix round 1, item 8).
 */
export function PriceForms({
  wishId,
  target,
  bucket,
}: {
  wishId: string;
  target: number | null;
  bucket: string;
}) {
  const t = useTranslations();
  const money = useMoney();
  const price = useWishForm(setTargetAction.bind(null, wishId));
  const cond = useWishForm(setConditionAction.bind(null, wishId));
  const shown = wishConditionOf(bucket);
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
      <form onSubmit={price.onSubmit} className="max-w-xs space-y-2">
        <Field label={t('wish.page.price')} htmlFor="w-target" hint={t('wish.page.priceHint')}>
          <Input
            id="w-target"
            name="target"
            inputMode="decimal"
            defaultValue={target !== null ? money.input(target) : ''}
            placeholder={money.symbol}
            className="w-36 tabular-nums"
          />
        </Field>
        <SaveRow state={price.state} pending={price.pending} label={t('wish.page.save')} />
      </form>
      <form onSubmit={cond.onSubmit} className="max-w-xs space-y-2">
        <Field
          label={t('wish.game.condition')}
          htmlFor="w-condition"
          hint={t('wish.page.conditionHint')}
        >
          {/* A fitted box: the select and its arrow at the select's own width. */}
          <div className="w-fit max-w-full">
            <NativeSelect
              id="w-condition"
              name="condition"
              defaultValue={shown ?? ''}
              className="w-auto max-w-full"
            >
              {!shown && (
                <option value="" disabled>
                  {t('wish.page.chooseCondition')}
                </option>
              )}
              {WISH_CONDITIONS.map((c, i) => (
                <option key={c} value={c}>
                  {bucketLabel(ITEM_CONDITION_BUCKETS[i]!, t)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </Field>
        <SaveRow state={cond.state} pending={cond.pending} label={t('wish.page.save')} />
      </form>
    </div>
  );
}

/** A new estimate: a range, roughly when, risks, basis and sources (S36 C2). */
export function EstimateForm({ wishId }: { wishId: string }) {
  const t = useTranslations();
  const money = useMoney();
  const f = useWishForm(addEstimateAction.bind(null, wishId));
  return (
    <form key={f.key} onSubmit={f.onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('wish.page.estimate.low')} htmlFor="e-low">
          <Input id="e-low" name="low" inputMode="decimal" placeholder={money.symbol} required />
        </Field>
        <Field label={t('wish.page.estimate.high')} htmlFor="e-high">
          <Input id="e-high" name="high" inputMode="decimal" placeholder={money.symbol} required />
        </Field>
      </div>
      <Field
        label={t('wish.page.estimate.when')}
        htmlFor="e-when"
        hint={t('wish.page.estimate.whenHint')}
      >
        <Input id="e-when" name="settleBy" type="month" />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t('wish.page.estimate.risks')}</legend>
        {WISH_RISKS.map((r) => (
          <label key={r} className="flex min-h-8 items-center gap-2 text-sm">
            <input type="checkbox" name="risk" value={r} className="size-4" />
            {t(`wish.page.risk.${r}`)}
          </label>
        ))}
        <Input
          name="riskOther"
          aria-label={t('wish.page.estimate.riskOther')}
          placeholder={t('wish.page.estimate.riskOther')}
        />
      </fieldset>
      <Field label={t('wish.page.estimate.basis')} htmlFor="e-basis">
        <NativeSelect id="e-basis" name="basis" defaultValue="">
          <option value="">{t('wish.page.estimate.basisNone')}</option>
          {WISH_ESTIMATE_BASES.map((b) => (
            <option key={b} value={b}>
              {t(`wish.page.basis.${b}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        label={t('wish.page.estimate.sources')}
        htmlFor="e-sources"
        hint={t('wish.page.estimate.sourcesHint')}
      >
        <Textarea id="e-sources" name="sources" rows={2} />
      </Field>
      <SaveRow
        state={f.state}
        pending={f.pending}
        label={t('wish.page.estimate.add')}
        variant="default"
      />
    </form>
  );
}

/** A dated fact about the item, shared with everyone wishing for it (plan W14). */
export function FactForm({ wishId, today }: { wishId: string; today: string }) {
  const t = useTranslations();
  const f = useWishForm(recordFactAction.bind(null, wishId));
  return (
    <form key={f.key} onSubmit={f.onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('wish.page.fact.day')} htmlFor="f-day">
          <Input id="f-day" name="day" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field label={t('wish.page.fact.kind')} htmlFor="f-kind">
          <NativeSelect id="f-kind" name="kind" defaultValue="other">
            {ITEM_FACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`wish.page.factKind.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label={t('wish.page.fact.text')} htmlFor="f-text">
        <Input id="f-text" name="text" maxLength={500} />
      </Field>
      <Field label={t('wish.page.fact.link')} htmlFor="f-link">
        <Input id="f-link" name="sourceUrl" type="url" placeholder="https://" />
      </Field>
      <SaveRow state={f.state} pending={f.pending} label={t('wish.page.fact.add')} />
    </form>
  );
}
