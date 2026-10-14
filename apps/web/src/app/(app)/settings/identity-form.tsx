'use client';

import { type ProductClass, itemTypes } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { useTaxonomy } from '@/components/taxonomy-context';
import { cn } from '@/lib/utils';
import { setIdentitySourceAction } from './actions';

/** A market's identity page per item class (S11; admins). */
export function IdentityForm({
  market,
  chosen,
  choices,
  labels,
  editable,
}: {
  market: string;
  chosen: Partial<Record<ProductClass, string | null>>;
  /** Sources of the market with product pages. */
  choices: string[];
  labels: Record<string, string>;
  editable: boolean;
}) {
  const t = useTranslations('sourceRoles');
  const [pending, startTransition] = useTransition();
  const types = itemTypes(useTaxonomy());
  return (
    <dl className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', pending && 'opacity-60')}>
      {types.map(({ key: cls }) => {
        const key = chosen[cls] ?? null;
        return (
          <div key={cls} className="space-y-1.5 text-sm">
            <dt className="font-medium">{t(`class.${cls}`)}</dt>
            <dd>
              {editable ? (
                <NativeSelect
                  value={key ?? ''}
                  disabled={pending}
                  onChange={(e) =>
                    startTransition(() =>
                      setIdentitySourceAction(market, cls, e.target.value || null),
                    )
                  }
                  aria-label={t(`class.${cls}`)}
                  className="h-9 w-full"
                >
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {labels[c] ?? c}
                    </option>
                  ))}
                  <option value="">{t('identityNone')}</option>
                </NativeSelect>
              ) : (
                <span className={key ? undefined : 'text-muted-foreground'}>
                  {key ? (labels[key] ?? key) : t('identityNone')}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
