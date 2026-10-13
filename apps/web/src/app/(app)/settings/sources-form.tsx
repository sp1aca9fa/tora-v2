'use client';

import {
  ITEM_CLASSES,
  type ProductClass,
  SOURCE_ROLES,
  type SourceInfo,
  type SourceRole,
} from '@tora/core';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { setSourceRoleAction } from './actions';

/**
 * Each price source and its role per item class (requirements S8, sources with roles). The
 * admin can change a role; the plug-in's suggestion is marked.
 */
export function SourcesForm({
  sources,
  roles,
  editable,
}: {
  sources: SourceInfo[];
  roles: Record<string, Partial<Record<ProductClass, SourceRole>>>;
  editable: boolean;
}) {
  const t = useTranslations('sourceRoles');
  const [pending, startTransition] = useTransition();
  const priced = sources.filter((s) => !s.shopOnly);
  return (
    <div className={cn('overflow-x-auto', pending && 'opacity-60')}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3 font-normal">{t('source')}</th>
            {ITEM_CLASSES.map((cls) => (
              <th key={cls} className="py-1 pr-3 font-normal">
                {t(`class.${cls}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {priced.map((s) => (
            <tr key={s.key}>
              <td className="py-2 pr-3">
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {[
                    s.market?.toUpperCase(),
                    s.currency,
                    ...(s.priceKinds ?? []).map((k) => t(`kind.${k}`)),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </td>
              {ITEM_CLASSES.map((cls) => {
                const role = roles[s.key]?.[cls] ?? 'off';
                const suggested = s.roles?.[cls] ?? 'off';
                return (
                  <td key={cls} className="py-2 pr-3">
                    {editable ? (
                      <NativeSelect
                        value={role}
                        disabled={pending}
                        onChange={(e) =>
                          startTransition(() =>
                            setSourceRoleAction(s.key, cls, e.target.value as SourceRole),
                          )
                        }
                        aria-label={`${s.label} · ${t(`class.${cls}`)}`}
                        className="h-8 w-32 text-xs"
                      >
                        {SOURCE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`role.${r}`)}
                            {r === suggested ? ` (${t('suggested')})` : ''}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <span className={role === 'off' ? 'text-muted-foreground' : undefined}>
                        {t(`role.${role}`)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
