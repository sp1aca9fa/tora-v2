import {
  type Category,
  PLATFORM_SUGGESTIONS,
  type ProductField,
  type ProductKind,
  regionsFor,
  productFieldsFor,
} from '@tora/core';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

export type ProductDefaults = Partial<
  Record<ProductField | 'name' | 'region', string | number | null>
>;

/**
 * Name, region and the optional fields that apply to the category + kind. `franchiseInput`
 * adds a free-text franchise box (TCG franchises are usually picked with chips instead).
 */
export function ProductFields({
  category,
  kind,
  defaults = {},
  franchiseInput = category === 'game',
  franchiseSuggestions = [],
  showSetFields = true,
  showRegion = true,
}: {
  category: Category;
  kind: ProductKind;
  defaults?: ProductDefaults;
  franchiseInput?: boolean;
  franchiseSuggestions?: string[];
  showSetFields?: boolean;
  showRegion?: boolean;
}) {
  const t = useTranslations();
  const shown = new Set(productFieldsFor(category, kind));
  if (!showSetFields) {
    shown.delete('setName');
    shown.delete('setCode');
  }
  const value = (name: keyof ProductDefaults) =>
    defaults[name] === null || defaults[name] === undefined ? '' : String(defaults[name]);
  const text = (name: ProductField, props: React.ComponentProps<typeof Input> = {}) => (
    <Field label={t(`fields.${name}`)} htmlFor={`p-${name}`}>
      <Input
        id={`p-${name}`}
        name={name}
        defaultValue={value(name)}
        autoComplete="off"
        {...props}
      />
    </Field>
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('fields.name')} htmlFor="p-name" className="sm:col-span-2">
        <Input id="p-name" name="name" required defaultValue={value('name')} autoComplete="off" />
      </Field>
      {showRegion && (
        <Field label={t('fields.region')} htmlFor="p-region">
          <NativeSelect id="p-region" name="region" defaultValue={value('region') || 'jp'}>
            {regionsFor(category).map((r) => (
              <option key={r} value={r}>
                {t(`region.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {franchiseInput && text('franchise', { list: 'franchise-suggestions' })}
      {franchiseInput && (
        <datalist id="franchise-suggestions">
          {franchiseSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {shown.has('platform') && (
        <>
          {text('platform', { list: 'platform-suggestions' })}
          <datalist id="platform-suggestions">
            {PLATFORM_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}
      {shown.has('setName') && text('setName')}
      {shown.has('setCode') && text('setCode')}
      {shown.has('variant') && text('variant', { placeholder: t('add.variantPlaceholder') })}
      {shown.has('cardNumber') && text('cardNumber', { placeholder: '123/100' })}
      {shown.has('rarity') && text('rarity', { placeholder: 'SAR' })}
      {shown.has('releaseDate') && text('releaseDate', { type: 'date' })}
      {shown.has('retailPriceJpy') &&
        text('retailPriceJpy', { inputMode: 'numeric', placeholder: '¥' })}
    </div>
  );
}
