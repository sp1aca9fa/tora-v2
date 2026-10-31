'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { submitWith } from '@/lib/submit-form';
import { type TrackingState, setTrackingAction } from './tracking-actions';

/** How the lot counts in the portfolio: cost, value, both or neither (requirements S8). */
export function TrackingForm({
  holdingId,
  countInCost,
  countInValue,
  otherLots,
}: {
  holdingId: string;
  countInCost: boolean;
  countInValue: boolean;
  /** Other lots of the same item ("apply to every lot" is offered when there are some). */
  otherLots: number;
}) {
  const t = useTranslations('tracking');
  const [cost, setCost] = useState(countInCost);
  const [value, setValue] = useState(countInValue);
  const [state, formAction, pending] = useActionState<TrackingState, FormData>(
    setTrackingAction.bind(null, holdingId),
    {},
  );
  const changed = cost !== countInCost || value !== countInValue;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submitWith(formAction)} className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="countInCost"
              checked={cost}
              onChange={(e) => setCost(e.target.checked)}
              className="size-4"
            />
            {t('inCost')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="countInValue"
              checked={value}
              onChange={(e) => setValue(e.target.checked)}
              className="size-4"
            />
            {t('inValue')}
          </label>
          {otherLots > 0 && (
            <label className="flex items-center gap-2 text-muted-foreground">
              <input type="checkbox" name="allLots" className="size-4" />
              {t('allLots')}
            </label>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>
              {t('save')}
            </Button>
            {state.saved && !changed && (
              <p role="status" className="text-muted-foreground">
                {t('saved')}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
