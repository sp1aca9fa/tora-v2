'use client';

import type { RateSetting } from '@tora/core';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { changeBaseAction, setRateAction } from './actions';

export interface CurrencyRow {
  code: string;
  /** Markets whose sources price in it. */
  markets: string[];
  /** Rate plug-ins covering it and the base. */
  choices: { key: string; label: string }[];
  /** Where its rate comes from now (the admin's choice, else the first plug-in); null: nowhere. */
  setting: RateSetting | null;
  latest: { date: string; rate: number } | null;
}

/**
 * A typed rate as a positive number, or null. "1,234.5" and "1.234,5" read the last separator as
 * the decimal point; a lone comma is a decimal comma ("1,5").
 */
function typedRate(text: string): number | null {
  const s = text.trim().replace(/\s/g, '');
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  const normal =
    dot >= 0 && comma >= 0
      ? comma > dot
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '')
      : s.replace(',', '.');
  const n = /^\d*\.?\d+$|^\d+\.$/.test(normal) ? Number(normal) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Each other currency's exchange rate to the base (S16; admins): a plug-in or a typed rate. */
export function CurrencyForm({
  base,
  baseChoices,
  amounts,
  rows,
}: {
  base: string;
  /** Currencies with a stored rate to the base (the base can change to them). */
  baseChoices: string[];
  /** Stored amounts a base change converts. */
  amounts: number;
  rows: CurrencyRow[];
}) {
  const t = useTranslations('currency');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const name = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const rate = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: base,
      maximumFractionDigits: 6,
    }).format(n);
  return (
    <div className={cn('space-y-4 text-sm', pending && 'opacity-60')}>
      <div className="space-y-1.5">
        <p className="font-medium">{t('base')}</p>
        <NativeSelect
          value={base}
          disabled={pending}
          aria-label={t('base')}
          onChange={(e) => {
            const to = e.target.value;
            if (!window.confirm(t('confirm', { from: base, to, count: amounts }))) {
              e.target.value = base;
              return;
            }
            setError(null);
            startTransition(async () => {
              const state = await changeBaseAction(to);
              if (state.error) setError(te(state.error));
            });
          }}
          className="h-9 w-full sm:w-72"
        >
          {[base, ...baseChoices.filter((c) => c !== base)].map((c) => (
            <option key={c} value={c}>
              {c} ({name(c)})
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t('baseInfo')}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('noOthers')}</p>
      ) : (
        <div className="divide-y border-t">
          {rows.map((row) => (
            <RateRow
              key={row.code}
              row={row}
              name={name(row.code)}
              rate={rate}
              pending={pending}
              save={(s) => startTransition(() => setRateAction(row.code, s))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RateRow({
  row,
  name,
  rate,
  pending,
  save,
}: {
  row: CurrencyRow;
  name: string;
  rate: (n: number) => string;
  pending: boolean;
  save: (s: RateSetting | null) => void;
}) {
  const t = useTranslations('currency');
  const manual = row.setting && 'manual' in row.setting;
  const [typing, setTyping] = useState(!!manual);
  const [badRate, setBadRate] = useState(false);
  const [typed, setTyped] = useState(
    manual ? String(row.setting && 'manual' in row.setting ? row.setting.manual : '') : '',
  );
  const value = typing
    ? 'manual'
    : row.setting && 'source' in row.setting
      ? row.setting.source
      : '';
  return (
    <div className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="font-medium">
            {row.code} ({name})
          </span>
          <span className="block text-xs text-muted-foreground">
            {row.latest
              ? t('latest', { code: row.code, rate: rate(row.latest.rate), date: row.latest.date })
              : ''}
          </span>
          {!row.latest && (
            <span className="block text-xs text-amber-700 dark:text-amber-400">{t('missing')}</span>
          )}
        </div>
        <div className="w-full space-y-1 sm:w-64">
          <label htmlFor={`source-${row.code}`} className="text-xs text-muted-foreground">
            {t('source', { code: row.code })}
          </label>
          <NativeSelect
            id={`source-${row.code}`}
            value={value}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'manual') return setTyping(true);
              setTyping(false);
              save(v ? { source: v } : null);
            }}
            className="h-9 w-full"
          >
            {!row.setting && <option value="">{t('none')}</option>}
            {row.choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
            <option value="manual">{t('manual')}</option>
          </NativeSelect>
          {row.choices.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('noPlugins', { code: row.code })}</p>
          )}
        </div>
      </div>
      {typing && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = typedRate(typed);
            setBadRate(n === null);
            if (n !== null) save({ manual: n });
          }}
        >
          <label htmlFor={`rate-${row.code}`} className="text-xs text-muted-foreground">
            {t('typedLabel', { code: row.code })}
          </label>
          <Input
            id={`rate-${row.code}`}
            inputMode="decimal"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setBadRate(false);
            }}
            aria-invalid={badRate || undefined}
            aria-describedby={badRate ? `rate-error-${row.code}` : undefined}
            className="h-9 w-32"
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {t('save')}
          </Button>
          {badRate && (
            <span
              id={`rate-error-${row.code}`}
              role="alert"
              className="w-full text-xs text-destructive"
            >
              {t('rateInvalid')}
            </span>
          )}
          <span className="w-full text-xs text-muted-foreground">{t('manualInfo')}</span>
        </form>
      )}
    </div>
  );
}
