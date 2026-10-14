import {
  type Category,
  type FieldDef,
  PLATFORM_SUGGESTIONS,
  type ProductField,
  type ProductKind,
  categoryDef,
  fieldType,
  fieldsFor,
  pickName,
} from '@tora/core';
import { useLocale, useTranslations } from 'next-intl';
import { Field } from '@/components/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useMoney } from '@/components/money-context';
import { useTaxonomy } from '@/components/taxonomy-context';

export type ProductDefaults = Partial<
  Record<ProductField | 'name' | 'nameAlias' | 'region', string | number | null>
> & { fields?: Record<string, string | number | boolean> | null };

/** Form name of a custom field's input (S16). */
export const customFieldName = (key: string) => `f_${key}`;

/**
 * Name, region and the optional fields that apply to the category + kind. `franchiseInput`
 * adds a free-text franchise box (TCG franchises are usually picked with chips instead).
 */
export function ProductFields({
  category,
  kind,
  defaults = {},
  franchiseInput,
  franchiseSuggestions = [],
  showSetFields = true,
  showRegion,
  onTyped,
}: {
  category: Category;
  kind: ProductKind;
  defaults?: ProductDefaults;
  franchiseInput?: boolean;
  franchiseSuggestions?: string[];
  showSetFields?: boolean;
  showRegion?: boolean;
  /** Reports what is typed in the identifying fields (name, set code, card number). */
  onTyped?: (field: 'name' | 'setCode' | 'cardNumber', value: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const money = useMoney();
  const taxonomy = useTaxonomy();
  const def = categoryDef(taxonomy, category);
  // TCG picks its franchise with chips (the set catalog); other categories type it.
  const typedFranchise = franchiseInput ?? !def?.setCatalog;
  const regions = def?.regions ?? [];
  const withRegion = (showRegion ?? true) && regions.length > 0;
  const fields = fieldsFor(taxonomy, category, kind).filter(
    (f) => showSetFields || !(f.standard && (f.key === 'setName' || f.key === 'setCode')),
  );
  const label = (f: FieldDef) =>
    f.names
      ? pickName(f.names, locale, f.key)
      : t.has(`fields.${f.key}`)
        ? t(`fields.${f.key}`)
        : f.key;
  const value = (name: keyof ProductDefaults) =>
    defaults[name] === null || defaults[name] === undefined
      ? ''
      : name === 'retailPriceBase'
        ? money.input(Number(defaults[name]))
        : String(defaults[name]);
  const text = (f: FieldDef, props: React.ComponentProps<typeof Input> = {}) => {
    const name = f.key as ProductField;
    return (
      <Field label={label(f)} htmlFor={`p-${name}`}>
        <Input
          id={`p-${name}`}
          name={name}
          required={f.required}
          defaultValue={value(name)}
          autoComplete="off"
          onChange={
            onTyped && (name === 'setCode' || name === 'cardNumber')
              ? (e) => onTyped(name, e.target.value)
              : undefined
          }
          {...props}
        />
      </Field>
    );
  };

  /** An admin's own field (S16): text, number, date, a choice or yes / no. */
  const custom = (f: FieldDef) => {
    const id = `p-f-${f.key}`;
    const name = customFieldName(f.key);
    const current = defaults.fields?.[f.key];
    const type = fieldType(f);
    if (type === 'choice' || type === 'yesno') {
      const options =
        type === 'yesno'
          ? [
              { key: 'true', label: t('common.yes') },
              { key: 'false', label: t('common.no') },
            ]
          : (f.choices ?? []).map((c) => ({ key: c.key, label: pickName(c.names, locale, c.key) }));
      return (
        <Field key={f.key} label={label(f)} htmlFor={id}>
          <NativeSelect
            id={id}
            name={name}
            required={f.required}
            defaultValue={current === undefined ? '' : String(current)}
          >
            <option value="">-</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      );
    }
    return (
      <Field key={f.key} label={label(f)} htmlFor={id}>
        <Input
          id={id}
          name={name}
          required={f.required}
          type={type === 'date' ? 'date' : 'text'}
          inputMode={type === 'number' ? 'decimal' : undefined}
          defaultValue={current === undefined ? '' : String(current)}
          autoComplete="off"
        />
      </Field>
    );
  };

  /** A standard field (S16: switched on per category), as before. */
  const standard = (f: FieldDef) => {
    switch (f.key as ProductField) {
      case 'franchise':
        return typedFranchise ? (
          <div key={f.key} className="contents">
            {text(f, { list: 'franchise-suggestions' })}
            <datalist id="franchise-suggestions">
              {franchiseSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        ) : null;
      case 'platform':
        return (
          <div key={f.key} className="contents">
            {text(f, { list: 'platform-suggestions' })}
            <datalist id="platform-suggestions">
              {PLATFORM_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        );
      case 'variant':
        return (
          <div key={f.key} className="contents">
            {text(f, { placeholder: t('add.variantPlaceholder') })}
          </div>
        );
      case 'cardNumber':
        return (
          <div key={f.key} className="contents">
            {text(f, { placeholder: '123/100' })}
          </div>
        );
      case 'rarity':
        return (
          <div key={f.key} className="contents">
            {text(f, { placeholder: 'SAR' })}
          </div>
        );
      case 'releaseDate':
        return (
          <div key={f.key} className="contents">
            {text(f, { type: 'date' })}
          </div>
        );
      case 'retailPriceBase':
        return (
          <div key={f.key} className="contents">
            {text(f, { inputMode: 'decimal', placeholder: money.symbol })}
          </div>
        );
      default:
        return (
          <div key={f.key} className="contents">
            {text(f)}
          </div>
        );
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={t('fields.name')} htmlFor="p-name" className="sm:col-span-2">
        <Input
          id="p-name"
          name="name"
          required
          defaultValue={value('name')}
          autoComplete="off"
          onChange={onTyped && ((e) => onTyped('name', e.target.value))}
        />
      </Field>
      <Field
        label={t('fields.nameAlias')}
        htmlFor="p-nameAlias"
        hint={t('fields.nameAliasHint')}
        className="sm:col-span-2"
      >
        <Input
          id="p-nameAlias"
          name="nameAlias"
          defaultValue={value('nameAlias')}
          autoComplete="off"
        />
      </Field>
      {withRegion && (
        <Field label={t('fields.region')} htmlFor="p-region">
          <NativeSelect id="p-region" name="region" defaultValue={value('region') || regions[0]}>
            {regions.map((r) => (
              <option key={r} value={r}>
                {t.has(`region.${r}`) ? t(`region.${r}`) : r}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {fields.map((f) => (f.standard ? standard(f) : custom(f)))}
    </div>
  );
}
