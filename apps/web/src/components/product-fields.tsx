import { LANGUAGES, PRODUCT_FIELDS, type ProductType } from '@tora/core';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

type ProductDefaults = Partial<
  Record<
    | 'nameJa'
    | 'nameEn'
    | 'franchise'
    | 'setName'
    | 'setCode'
    | 'cardNumber'
    | 'rarity'
    | 'language'
    | 'releaseDate',
    string | null
  > & { retailPriceJpy: number | null }
>;

/** Name fields plus the optional fields that apply to the product type. */
export function ProductFields({
  type,
  defaults = {},
}: {
  type: ProductType;
  defaults?: ProductDefaults;
}) {
  const t = useTranslations();
  const shown = new Set(PRODUCT_FIELDS[type]);
  const text = (name: keyof ProductDefaults, props: React.ComponentProps<typeof Input> = {}) => (
    <Field label={t(`fields.${name}`)} htmlFor={`p-${name}`}>
      <Input
        id={`p-${name}`}
        name={name}
        defaultValue={defaults[name] ?? ''}
        autoComplete="off"
        {...props}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {text('nameEn', { lang: 'en' })}
        {text('nameJa', { lang: 'ja' })}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t('add.nameHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {shown.has('franchise') && text('franchise')}
        {shown.has('setName') && text('setName')}
        {shown.has('setCode') && text('setCode')}
        {shown.has('cardNumber') && text('cardNumber')}
        {shown.has('rarity') && text('rarity')}
        {shown.has('language') && (
          <Field label={t('fields.language')} htmlFor="p-language">
            <NativeSelect id="p-language" name="language" defaultValue={defaults.language ?? 'JP'}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {t(`language.${l}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {shown.has('releaseDate') &&
          text('releaseDate', { type: 'date', defaultValue: defaults.releaseDate ?? '' })}
        {shown.has('retailPriceJpy') &&
          text('retailPriceJpy', { inputMode: 'numeric', placeholder: '¥' })}
      </div>
    </div>
  );
}
