'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useMoney } from '@/components/money-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setMarketOptionsAction } from './actions';

/** The cost above which items outside cards and sealed TCG need an identity link (S16; admins). */
export function IdentityAmountForm({ amount }: { amount: number }) {
  const t = useTranslations('identity');
  const money = useMoney();
  const [text, setText] = useState(money.input(amount));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const value = money.parse(text);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value === null || value < 0) return;
        startTransition(async () => {
          await setMarketOptionsAction({ identityMinCost: value });
          setSaved(true);
        });
      }}
    >
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        inputMode="decimal"
        placeholder={money.symbol}
        aria-label={t('amount')}
        aria-invalid={value === null || value < 0}
        className="max-w-40"
      />
      <Button
        type="submit"
        variant="outline"
        disabled={pending || value === null || value < 0 || value === amount}
      >
        {t('amountSave')}
      </Button>
      {saved && !pending && (
        <span className="text-sm text-muted-foreground">{t('amountSaved')}</span>
      )}
    </form>
  );
}
