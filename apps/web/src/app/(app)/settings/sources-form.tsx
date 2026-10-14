'use client';

import {
  bestRole,
  ITEM_CLASSES,
  type ProductClass,
  SOURCE_ROLES,
  type SourceInfo,
  type SourceQuality,
  type SourceRole,
} from '@tora/core';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { moveSourceAction, setSourceRoleAction } from './actions';

/**
 * Each price source and its role per item class (requirements S8, sources with roles). The
 * admin can change a role; the plug-in's suggestion shows when the role differs. Sources are
 * grouped by their most important role; arrows set the order within a group.
 */
export function SourcesForm({
  sources,
  roles,
  quality,
  labels,
  editable,
}: {
  sources: SourceInfo[];
  /** The declared roles (what the admin set or the plug-in suggested). */
  roles: Record<string, Partial<Record<ProductClass, SourceRole>>>;
  /** The quality gate's last check per source and class. */
  quality: Record<string, Partial<Record<ProductClass, SourceQuality>>>;
  labels: Record<string, string>;
  editable: boolean;
}) {
  const t = useTranslations('sourceRoles');
  const [pending, startTransition] = useTransition();
  const priced = sources.filter((s) => !s.shopOnly);
  const groups = SOURCE_ROLES.map((r) => ({
    role: r,
    sources: priced.filter((s) => bestRole(roles[s.key]) === r),
  })).filter((g) => g.sources.length > 0);
  const move = (key: string, step: -1 | 1) => startTransition(() => moveSourceAction(key, step));
  return (
    // A row per source on wide screens; on phones each source is a block, one line per class.
    <div className={cn('space-y-2 text-sm', pending && 'opacity-60')}>
      <p className="text-xs text-muted-foreground">{t('perClass')}</p>
      <p className="text-xs text-muted-foreground">{t('orderNote')}</p>
      <div className="hidden gap-4 text-xs text-muted-foreground md:grid md:grid-cols-[minmax(12rem,1.2fr)_repeat(3,minmax(0,1fr))]">
        <span>{t('source')}</span>
        {ITEM_CLASSES.map((cls) => (
          <span key={cls}>{t(`class.${cls}`)}</span>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g.role} className="pt-2">
          <h3 className="border-b pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t(`group.${g.role}`)}
          </h3>
          <div className="divide-y">
            {g.sources.map((s, i) => (
              <div
                key={s.key}
                className="grid grid-cols-1 gap-2 py-3 md:gap-4 md:grid-cols-[minmax(12rem,1.2fr)_repeat(3,minmax(0,1fr))]"
              >
                <div className="flex items-start gap-2">
                  {editable && g.sources.length > 1 && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        onClick={() => move(s.key, -1)}
                        aria-label={t('moveUp', { source: s.label })}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === g.sources.length - 1}
                        onClick={() => move(s.key, 1)}
                        aria-label={t('moveDown', { source: s.label })}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronDown className="size-4" />
                      </button>
                    </div>
                  )}
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
                </div>
                {ITEM_CLASSES.map((cls) => {
                  const role = roles[s.key]?.[cls] ?? 'off';
                  const suggested = s.roles?.[cls] ?? 'off';
                  const q = role === 'supporting' ? quality[s.key]?.[cls] : undefined;
                  const pct = Math.round(Math.abs(q?.bias ?? 0) * 100);
                  return (
                    <div
                      key={cls}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 md:block"
                    >
                      <span className="text-muted-foreground md:hidden">{t(`class.${cls}`)}</span>
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
                          className="h-9 w-40 md:w-full md:max-w-48"
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
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
