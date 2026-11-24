'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitWith } from '@/lib/submit-form';
import { cn } from '@/lib/utils';
import { type TrackedAddState, trackedAddAction } from './actions';

/**
 * Tracked games from pasted lines (spec wishlist-tracked W18, W9's preview): `name | console` per
 * line, a preview per line (a new item or a look-alike already in Tora; an unknown console is the
 * line's error), nothing written until confirmed. The chosen set (read weekly) is the default tier.
 */
export function TrackedAddForm({ max }: { max: number }) {
  const t = useTranslations('tracked');
  const tb = useTranslations('wish.bulk');
  const [state, action, pending] = useActionState<TrackedAddState, FormData>(trackedAddAction, {});
  const lines = state.results ? undefined : state.lines;
  // Edited after the preview, the list is previewed again before anything is added (as W9's).
  const [text, setText] = useState(state.text ?? '');
  const changed = !!lines && text !== (state.text ?? '');
  const lineError = (e: string, console = '') =>
    t.has(`error.${e}`)
      ? t(`error.${e}`)
      : tb.has(`error.${e}`)
        ? tb(`error.${e}`, { console })
        : tb('error.failed');

  if (state.results) {
    const ok = state.results.filter((r) => r.ok).length;
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">
          {tb('result', { ok, failed: state.results.length - ok })}
        </p>
        <ul className="divide-y rounded-lg border text-sm">
          {state.results.map((r) => (
            <li
              key={r.line}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 break-words">{r.name || '-'}</span>
              <span className={cn('text-xs', !r.ok && 'text-destructive')}>
                {r.ok
                  ? t(r.already ? 'already' : r.reused ? 'addedReused' : 'added')
                  : lineError(r.error)}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={submitWith(action)}>
          <Button
            type="submit"
            name="step"
            value="edit"
            variant="outline"
            onClick={() => setText('')}
          >
            {t('addMore')}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={submitWith(action)} className="space-y-3">
      <p className="text-sm text-muted-foreground">{tb('intro')}</p>
      <Textarea
        name="text"
        aria-label={tb('label')}
        rows={lines ? 6 : 8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={tb('placeholder')}
        className="font-mono text-sm"
      />
      <fieldset className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <legend className="sr-only">{t('tier')}</legend>
        {(['chosen', 'rest'] as const).map((tier) => (
          <label key={tier} className="flex min-h-8 items-start gap-2 py-1">
            <input
              type="radio"
              name="tier"
              value={tier}
              defaultChecked={(state.tier ?? 'chosen') === tier}
              className="mt-1"
            />
            <span>
              {t(`tierName.${tier}`)}
              <span className="block text-xs text-muted-foreground">{t(`tierHint.${tier}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {!lines && <FormError state={state} />}
      <Button
        type="submit"
        name="step"
        value="preview"
        variant={lines ? 'outline' : 'default'}
        disabled={pending}
      >
        {tb('preview')}
      </Button>
      {lines && (
        <div className="space-y-3">
          {state.tooMany && (
            <p role="alert" className="text-sm text-destructive">
              {tb('tooMany', { max })}
            </p>
          )}
          <ol className="grid gap-2">
            {lines.map((l) => (
              <li
                key={l.line}
                className={cn(
                  'space-y-1.5 rounded-lg border px-3 py-2 text-sm',
                  l.error && 'border-destructive/40 bg-destructive/5',
                  changed && 'opacity-60',
                )}
              >
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium break-words">{l.name || '-'}</span>
                  {l.consoleName && (
                    <span className="text-xs text-muted-foreground">{l.consoleName}</span>
                  )}
                </p>
                {l.error ? (
                  <p className="text-xs text-destructive">{lineError(l.error, l.consoleText)}</p>
                ) : (
                  <fieldset className="space-y-1 text-xs">
                    {l.lookAlikes.map((a, i) => (
                      <label key={a.id} className="flex items-start gap-2">
                        <input
                          type="radio"
                          name={`choice-${l.line}`}
                          value={a.id}
                          defaultChecked={i === 0}
                          className="mt-0.5"
                        />
                        <span>
                          {tb('reuse', { name: a.name })}
                          {a.tracked && (
                            <span className="text-muted-foreground"> ({t('trackedAlready')})</span>
                          )}
                        </span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`choice-${l.line}`}
                        value="new"
                        defaultChecked={!l.lookAlikes.length}
                      />
                      {tb('new')}
                    </label>
                  </fieldset>
                )}
              </li>
            ))}
          </ol>
          <FormError state={state} />
          {changed && <p className="text-sm text-amber-700 dark:text-amber-300">{tb('changed')}</p>}
          <Button
            type="submit"
            name="step"
            value="confirm"
            disabled={pending || changed || state.tooMany || !lines.some((l) => !l.error)}
          >
            {t('confirm', { count: lines.filter((l) => !l.error).length })}
          </Button>
        </div>
      )}
    </form>
  );
}
