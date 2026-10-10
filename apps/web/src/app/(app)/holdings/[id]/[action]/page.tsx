import {
  CONDITIONS,
  GRADERS,
  PACKAGING_STATES,
  RAW_GRADES,
  productClass,
  holdingFieldsFor,
  openedStatesFor,
  pendingGrading,
  tokyoDate,
} from '@tora/core';
import { getHoldingDetail } from '@tora/db';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { authed } from '@/lib/auth/guard';
import {
  conditionAction,
  cancelOrderAction,
  deleteAction,
  editAction,
  gradeReturnAction,
  gradeSubmitAction,
  noteAction,
  openAction,
  sellAction,
  splitAction,
} from '../actions';

const ACTIONS = {
  edit: editAction,
  split: splitAction,
  open: openAction,
  'grade-submit': gradeSubmitAction,
  'grade-return': gradeReturnAction,
  sell: sellAction,
  condition: conditionAction,
  note: noteAction,
  delete: deleteAction,
  'cancel-order': cancelOrderAction,
} as const;
type ActionKey = keyof typeof ACTIONS;

const PLATFORMS = [
  'Mercari',
  'SNKRDUNK',
  'Yahoo Auctions',
  'Yahoo Flea Market',
  'eBay',
  '駿河屋',
  'Card shop',
];

export default async function HoldingActionPage({
  params,
}: {
  params: Promise<{ id: string; action: string }>;
}) {
  const { id, action } = await params;
  if (!(action in ACTIONS)) notFound();
  const key = action as ActionKey;
  const { db, user } = await authed();
  const detail = await getHoldingDetail(db, user.id, id);
  if (!detail) notFound();
  const { holding, product, events } = detail;
  const t = await getTranslations();
  const today = tokyoDate();
  const cls = productClass(product);
  const fields = holdingFieldsFor(cls);
  const back = `/holdings/${id}`;

  const dateField = (
    <Field label={t('fields.date')} htmlFor="date">
      <Input id="date" name="date" type="date" required defaultValue={today} max={today} />
    </Field>
  );

  /** Quantity affected; hidden for single units. Splitting happens automatically when partial. */
  const quantityField = (defaultValue = holding.quantity, max = holding.quantity) =>
    holding.quantity > 1 ? (
      <Field
        label={t('fields.quantity')}
        htmlFor="quantity"
        hint={t('actions.partialHint', { total: holding.quantity })}
      >
        <Input
          id="quantity"
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          required
          defaultValue={defaultValue}
        />
      </Field>
    ) : (
      <input type="hidden" name="quantity" value="1" />
    );

  const yenInput = (name: string, required = true) => (
    <Input id={name} name={name} inputMode="numeric" placeholder="¥" required={required} />
  );

  let body: React.ReactNode;
  switch (key) {
    case 'edit':
      body = (
        <div className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="originalDate" value={holding.acquiredAt.slice(0, 10)} />
          <Field label={t('fields.acquiredAt')} htmlFor="acquiredAt">
            <Input
              id="acquiredAt"
              name="acquiredAt"
              type="date"
              required
              max={today}
              defaultValue={holding.acquiredAt.slice(0, 10)}
            />
          </Field>
          <Field label={t('fields.acquiredFrom')} htmlFor="acquiredFrom">
            <Input
              id="acquiredFrom"
              name="acquiredFrom"
              defaultValue={holding.acquiredFrom ?? ''}
            />
          </Field>
          <Field label={t('fields.acquisitionType')} htmlFor="acquisitionType">
            <NativeSelect
              id="acquisitionType"
              name="acquisitionType"
              defaultValue={holding.acquisitionType}
            >
              {(holding.parentHoldingId
                ? (['pull'] as const)
                : (['purchase', 'gift', 'trade'] as const)
              ).map((a) => (
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
              required
              defaultValue={holding.quantity}
            />
          </Field>
          <Field
            label={t('fields.costTotalJpy')}
            htmlFor="costTotalJpy"
            hint={t('actions.editCostHint')}
          >
            <Input
              id="costTotalJpy"
              name="costTotalJpy"
              inputMode="numeric"
              required
              defaultValue={holding.costTotalJpy}
            />
          </Field>
          {fields.grading && (
            <Field label={t('fields.certNumber')} htmlFor="certNumber">
              <Input id="certNumber" name="certNumber" defaultValue={holding.certNumber ?? ''} />
            </Field>
          )}
          <Field label={t('fields.orderId')} htmlFor="orderId" hint={t('add.orderIdHint')}>
            <Input id="orderId" name="orderId" defaultValue={holding.orderId ?? ''} />
          </Field>
          <Field label={t('fields.notes')} htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" name="notes" rows={3} defaultValue={holding.notes ?? ''} />
          </Field>
        </div>
      );
      break;
    case 'split':
      body = (
        <>
          <Field
            label={t('actions.splitQuantity')}
            htmlFor="quantity"
            hint={t('actions.splitHint')}
          >
            <Input
              id="quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={holding.quantity - 1}
              required
              defaultValue={1}
            />
          </Field>
          {dateField}
        </>
      );
      break;
    case 'open': {
      const states = openedStatesFor(cls);
      body = (
        <>
          {quantityField()}
          <Field
            label={t('fields.packagingState')}
            htmlFor="packagingState"
            hint={cls === 'sealed' ? t('actions.openSealedHint') : undefined}
          >
            <NativeSelect
              id="packagingState"
              name="packagingState"
              defaultValue={states.includes('opened') ? 'opened' : states[0]}
            >
              {states.map((s) => (
                <option key={s} value={s}>
                  {t(`packaging.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {dateField}
        </>
      );
      break;
    }
    case 'grade-submit':
      body = (
        <>
          {quantityField(1)}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fields.grader')} htmlFor="grader">
              <NativeSelect id="grader" name="grader" defaultValue="PSA">
                {GRADERS.map((g) => (
                  <option key={g} value={g}>
                    {g === 'other' ? t('common.other') : g}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('fields.feeJpy')} htmlFor="feeJpy" hint={t('actions.feeHint')}>
              {yenInput('feeJpy')}
            </Field>
            <Field label={t('fields.service')} htmlFor="service">
              <Input id="service" name="service" placeholder="Value / Regular" />
            </Field>
            {dateField}
          </div>
        </>
      );
      break;
    case 'grade-return': {
      const pending = pendingGrading(events);
      body = (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.grader')} htmlFor="grader">
            <NativeSelect id="grader" name="grader" defaultValue={pending?.grader ?? 'PSA'}>
              {GRADERS.map((g) => (
                <option key={g} value={g}>
                  {g === 'other' ? t('common.other') : g}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('fields.grade')} htmlFor="grade">
            <Input id="grade" name="grade" inputMode="decimal" required placeholder="10" />
          </Field>
          <Field label={t('fields.certNumber')} htmlFor="certNumber">
            <Input id="certNumber" name="certNumber" inputMode="numeric" />
          </Field>
          <Field
            label={t('fields.extraFeeJpy')}
            htmlFor="extraFeeJpy"
            hint={t('actions.extraFeeHint')}
          >
            {yenInput('extraFeeJpy', false)}
          </Field>
          {dateField}
        </div>
      );
      break;
    }
    case 'sell':
      body = (
        <>
          {quantityField()}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fields.priceJpy')} htmlFor="priceJpy" hint={t('actions.priceHint')}>
              {yenInput('priceJpy')}
            </Field>
            <Field label={t('fields.feesJpy')} htmlFor="feesJpy" hint={t('actions.feesHint')}>
              {yenInput('feesJpy', false)}
            </Field>
            <Field label={t('fields.platform')} htmlFor="platform">
              <Input id="platform" name="platform" list="platforms" autoComplete="off" />
              <datalist id="platforms">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            {dateField}
          </div>
        </>
      );
      break;
    case 'condition':
      body = (
        <>
          {quantityField()}
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.grading && holding.grading !== 'graded' && (
              <Field label={t('fields.rawGrade')} htmlFor="rawGrade">
                <NativeSelect id="rawGrade" name="rawGrade" defaultValue={holding.rawGrade ?? 'A'}>
                  {RAW_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {fields.condition && (
              <Field label={t('fields.condition')} htmlFor="condition">
                <NativeSelect
                  id="condition"
                  name="condition"
                  defaultValue={holding.condition ?? 'new_unused'}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {t(`condition.${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {fields.packaging && (
              <Field label={t('fields.packagingState')} htmlFor="packagingState">
                <NativeSelect
                  id="packagingState"
                  name="packagingState"
                  defaultValue={holding.packagingState ?? ''}
                >
                  <option value="">{t('common.notSet')}</option>
                  {PACKAGING_STATES.filter(
                    (p) => p !== 'n/a' && (cls === 'sealed' || p !== 'box_opened_contents_sealed'),
                  ).map((p) => (
                    <option key={p} value={p}>
                      {t(`packaging.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {dateField}
          </div>
        </>
      );
      break;
    case 'note':
      body = (
        <>
          <Field label={t('fields.text')} htmlFor="text">
            <Textarea id="text" name="text" rows={4} required autoFocus />
          </Field>
          {dateField}
        </>
      );
      break;
    case 'cancel-order':
      body = (
        <label className="flex items-start gap-3 rounded-md border border-destructive/40 p-3 text-sm">
          <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
          <span>
            {t('actions.cancelOrderConfirm', {
              order: holding.orderId ?? '-',
              from: holding.acquiredFrom ?? '-',
            })}
          </span>
        </label>
      );
      break;
    case 'delete':
      body = (
        <label className="flex items-start gap-3 rounded-md border border-destructive/40 p-3 text-sm">
          <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
          <span>{t('actions.deleteConfirm')}</span>
        </label>
      );
      break;
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{product.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t(`holding.actions.${key}`)}</h1>
        {t.has(`actions.intro.${key}`) && (
          <p className="text-sm text-muted-foreground">{t(`actions.intro.${key}`)}</p>
        )}
      </header>
      <ActionForm
        action={ACTIONS[key].bind(null, id)}
        submitLabel={t(`holding.actions.${key}`)}
        cancelHref={back}
        destructive={key === 'delete' || key === 'cancel-order'}
      >
        {body}
      </ActionForm>
    </div>
  );
}
