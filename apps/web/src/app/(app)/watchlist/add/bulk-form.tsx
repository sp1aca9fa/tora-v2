'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitWith } from '@/lib/submit-form';
import { cn } from '@/lib/utils';
import { type BulkState, bulkWishAction } from '../wish-actions';
import { sameList } from './bulk-text';

/**
 * Several games pasted at once (S36 B1): a line per game, `name | console`; a preview per line (a new
 * item, or one already in Tora that reads the same, chosen per line; an unknown console is the
 * line's error), and nothing is written until the person confirms. Then each line is added on its
 * own: a line that fails is reported and the others stand.
 */
export function BulkForm({ max }: { max: number }) {
  const t = useTranslations('wish.bulk');
  const [state, action, pending] = useActionState<BulkState, FormData>(bulkWishAction, {});
  const lines = state.results ? undefined : state.lines;
  // The list stays beside its preview (fix U10); edited after the preview, it is previewed again
  // before anything is added, so what is added is what was shown.
  const [text, setText] = useState(state.text ?? '');
  const changed = !!lines && !sameList(text, state.text ?? '');

  if (state.results) {
    const ok = state.results.filter((r) => r.ok).length;
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">
          {t('result', { ok, failed: state.results.length - ok })}
        </p>
        <ul className="divide-y rounded-lg border text-sm">
          {state.results.map((r) => (
            <li
              key={r.line}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 break-words">{r.name || '-'}</span>
              {r.ok ? (
                <Link href={`/watchlist/${r.wishId}/check`} className="text-xs underline">
                  {t('added')}
                </Link>
              ) : (
                <span className="text-xs text-destructive">
                  {t.has(`error.${r.error}`) ? t(`error.${r.error}`) : t('error.failed')}
                </span>
              )}
            </li>
          ))}
        </ul>
        <Button asChild variant="outline">
          <Link href="/watchlist">{t('done')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submitWith(action)} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <p className="text-xs text-muted-foreground">{t('conditionNote')}</p>
      <div
        className={cn(
          'grid items-start gap-4',
          lines && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]',
        )}
      >
        <div className="space-y-3">
          <Textarea
            name="text"
            aria-label={t('label')}
            rows={lines ? 12 : 8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('placeholder')}
            className="font-mono text-sm"
          />
          {!lines && <FormError state={state} />}
          <Button
            type="submit"
            name="step"
            value="preview"
            variant={lines ? 'outline' : 'default'}
            disabled={pending}
          >
            {t('preview')}
          </Button>
        </div>
        {lines && (
          <div className="space-y-3">
            {state.tooMany && (
              <p role="alert" className="text-sm text-destructive">
                {t('tooMany', { max })}
              </p>
            )}
            <ol className="grid gap-2 min-[2400px]:grid-cols-2">
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
                    <p className="text-xs text-destructive">
                      {t(`error.${l.error}`, { console: l.consoleText })}
                    </p>
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
                            {t('reuse', { name: a.name })}
                            {a.wished && (
                              <span className="text-muted-foreground"> ({t('wished')})</span>
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
                        {t('new')}
                      </label>
                    </fieldset>
                  )}
                </li>
              ))}
            </ol>
            <FormError state={state} />
            {changed && (
              <p className="text-sm text-amber-700 dark:text-amber-300">{t('changed')}</p>
            )}
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
      </div>
    </form>
  );
}
