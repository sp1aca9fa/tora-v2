'use client';

import type { ProductClass } from '@tora/core';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { type ConditionDefaults, ConditionFields } from '@/components/condition-fields';
import { FormError } from '@/components/form-error';
import { useMoney } from '@/components/money-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WatchTargetFields } from '../../add/add-flow';
import { removeWatchAction, saveWatchAction } from '../../watchlist/actions';

export interface WatchRow {
  id: string;
  label: string | null;
  target: number | null;
  note: string | null;
  defaults: ConditionDefaults;
}

function WatchForm({
  productId,
  cls,
  retail,
  watch,
  onDone,
}: {
  productId: string;
  cls: ProductClass;
  retail: number | null;
  watch?: WatchRow;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(saveWatchAction, {});
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-4 rounded-md border p-3">
      <input type="hidden" name="productId" value={productId} />
      {watch && <input type="hidden" name="watchId" value={watch.id} />}
      <ConditionFields cls={cls} defaults={watch?.defaults} />
      <WatchTargetFields retail={retail} defaults={{ target: watch?.target, note: watch?.note }} />
      <FormError state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t(watch ? 'common.save' : 'watchlist.submit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * The person's watches of this item (S9): the condition, target and note of each, to change or
 * remove, and a form to watch it in another condition.
 */
export function WatchCard({
  productId,
  cls,
  retail,
  watches,
}: {
  productId: string;
  cls: ProductClass;
  retail: number | null;
  watches: WatchRow[];
}) {
  const t = useTranslations();
  const money = useMoney();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="size-4" /> {t('watchlist.card')}
        </CardTitle>
        <CardDescription>
          {watches.length ? t('watchlist.cardWatched') : t('watchlist.cardInfo')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {watches.length > 0 && (
          <ul className="divide-y rounded-md border">
            {watches.map((w) =>
              editing === w.id ? (
                <li key={w.id} className="p-2">
                  <WatchForm
                    productId={productId}
                    cls={cls}
                    retail={retail}
                    watch={w}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{w.label ?? t('watchlist.anyCondition')}</p>
                    <p className="text-xs break-words text-muted-foreground tabular-nums">
                      {[
                        w.target
                          ? t('watchlist.targetShort', { target: money(w.target) })
                          : t('watchlist.noTarget'),
                        w.note,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEditing(w.id)}>
                    {t('watchlist.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(t('watchlist.removeConfirm'))) return;
                      startTransition(() => removeWatchAction(w.id));
                    }}
                  >
                    {t('watchlist.remove')}
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
        {editing === 'new' ? (
          <WatchForm
            productId={productId}
            cls={cls}
            retail={retail}
            onDone={() => setEditing(null)}
          />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Eye /> {t(watches.length ? 'watchlist.watchAnother' : 'watchlist.watch')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
