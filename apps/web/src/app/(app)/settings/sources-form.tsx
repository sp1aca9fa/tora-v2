'use client';

import {
  type ProductClass,
  collects,
  itemTypes,
  SOURCE_ROLES,
  type SourceInfo,
  type SourceQuality,
  type SourceRole,
} from '@tora/core';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { useTaxonomy } from '@/components/taxonomy-context';
import { cn } from '@/lib/utils';
import { moveSourceAction, setSourceRoleAction } from './actions';

/**
 * A market's price sources for one kind of item at a time (requirements S8, sources with roles):
 * grouped by their role for that kind, in its order. The admin changes a role or moves a source
 * within its group; the plug-in's suggestion shows when the role differs.
 */
export function SourcesForm({
  sources,
  order,
  roles,
  quality,
  labels,
  editable,
}: {
  sources: SourceInfo[];
  /** Each kind of item's order of the sources (keys). */
  order: Partial<Record<ProductClass, string[]>>;
  /** The declared roles (what the admin set or the plug-in suggested). */
  roles: Record<string, Partial<Record<ProductClass, SourceRole>>>;
  /** The quality gate's last check per source and class. */
  quality: Record<string, Partial<Record<ProductClass, SourceQuality>>>;
  labels: Record<string, string>;
  editable: boolean;
}) {
  const t = useTranslations('sourceRoles');
  const [pending, startTransition] = useTransition();
  // Item types of the admin's categories (S16), each listing the sources that collect it.
  const types = itemTypes(useTaxonomy());
  const [cls, setCls] = useState<ProductClass>(types[0]?.key ?? 'card');
  const category = types.find((x) => x.key === cls)?.category ?? '';
  const ordered = order[cls] ?? [];
  const priced = sources
    .filter((s) => !s.shopOnly && collects(s, category))
    .toSorted((a, b) => ordered.indexOf(a.key) - ordered.indexOf(b.key));
  const roleOf = (key: string): SourceRole => roles[key]?.[cls] ?? 'off';
  const groups = SOURCE_ROLES.map((r) => ({
    role: r,
    sources: priced.filter((s) => roleOf(s.key) === r),
  })).filter((g) => g.sources.length > 0);
  const arrow =
    'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className={cn('space-y-3 text-sm', pending && 'opacity-60')}>
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {types.map(({ key: c }) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={c === cls}
            onClick={() => setCls(c)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              c === cls
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`class.${c}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('perClass')}</p>
      {groups.map((g) => (
        <section key={g.role} className="pt-1">
          <h3 className="border-b pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t(`group.${g.role}`)}
          </h3>
          <div className="divide-y">
            {g.sources.map((s, i) => {
              const role = roleOf(s.key);
              const suggested = s.roles?.[cls] ?? 'off';
              const q = role === 'supporting' ? quality[s.key]?.[cls] : undefined;
              const pct = Math.round(Math.abs(q?.bias ?? 0) * 100);
              return (
                <div key={s.key} className="flex items-start gap-2 py-3">
                  {editable && g.sources.length > 1 && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        onClick={() => startTransition(() => moveSourceAction(s.key, cls, -1))}
                        aria-label={t('moveUp', { source: s.label })}
                        className={arrow}
                      >
                        <ChevronUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === g.sources.length - 1}
                        onClick={() => startTransition(() => moveSourceAction(s.key, cls, 1))}
                        aria-label={t('moveDown', { source: s.label })}
                        className={arrow}
                      >
                        <ChevronDown className="size-4" />
                      </button>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
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
                      </div>
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
                          className="h-9 w-40"
                        >
                          {SOURCE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t(`role.${r}`)}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <span className={role === 'off' ? 'text-muted-foreground' : undefined}>
                          {t(`role.${role}`)}
                        </span>
                      )}
                    </div>
                    {role !== suggested && (
                      <span
                        className="mt-1 inline-flex w-full cursor-help items-center gap-1 text-xs text-muted-foreground"
                        title={t('suggestedWhy')}
                      >
                        {t('suggestedRole', { role: t(`role.${suggested}`) })}
                        <Info className="size-3" aria-label={t('suggestedWhy')} />
                      </span>
                    )}
                    {/* Asking or store prices only (e.g. eBay, 駿河屋): usable, but not sales. */}
                    {(role === 'reference' || role === 'supporting') &&
                      !!s.priceKinds?.length &&
                      !s.priceKinds.includes('sold') && (
                        <span className="mt-1 block w-full text-xs text-amber-700 dark:text-amber-400">
                          {t('asksOnly')}
                        </span>
                      )}
                    {q && (
                      <span
                        className={cn(
                          'mt-1 block w-full text-xs',
                          q.status === 'disagrees'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground',
                        )}
                      >
                        {t(`quality.${q.status}`, {
                          pct,
                          direction: t((q.bias ?? 0) < 0 ? 'quality.below' : 'quality.above'),
                          reference: labels[q.against ?? ''] ?? q.against ?? '',
                          count: q.pairs,
                        })}
                        {q.dismissedAt && ` · ${t('quality.dismissed')}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
