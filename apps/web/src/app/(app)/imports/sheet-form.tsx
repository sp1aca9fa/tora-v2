'use client';

import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  type SheetError,
  type SheetPreviewRow,
  importSheetAction,
  previewSheetAction,
} from './sheet-actions';

type State =
  | { step: 'idle' }
  | { step: 'checking' }
  | { step: 'preview'; rows: SheetPreviewRow[]; ignored: string[] }
  | { step: 'importing'; rows: SheetPreviewRow[]; ignored: string[] }
  | { step: 'done'; runId: string; imported: number }
  | { step: 'error'; error: SheetError };

/**
 * A spreadsheet in the download's layout (requirements S6): checked first, row by row; then the
 * new rows become lots waiting in Review. Rows already in Tora are left alone.
 */
export function SheetForm({ currency }: { currency: string }) {
  const t = useTranslations('imports.sheet');
  const format = useFormatter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ step: 'idle' });
  // Loose matches ticked "add anyway", by line.
  const [extra, setExtra] = useState<number[]>([]);
  const form = () => {
    const file = input.current?.files?.[0];
    if (!file) return null;
    const data = new FormData();
    data.set('file', file);
    return data;
  };
  const check = async () => {
    const data = form();
    if (!data) return;
    setState({ step: 'checking' });
    setExtra([]);
    const result = await previewSheetAction(data);
    setState('error' in result ? { step: 'error', ...result } : { step: 'preview', ...result });
  };
  const confirm = async () => {
    const data = form();
    if (!data || state.step !== 'preview') return;
    setState({ ...state, step: 'importing' });
    data.set('addAnyway', JSON.stringify(extra));
    const result = await importSheetAction(data);
    if (input.current) input.current.value = '';
    setState('error' in result ? { step: 'error', ...result } : { step: 'done', ...result });
  };
  const rows = state.step === 'preview' || state.step === 'importing' ? state.rows : [];
  const count = (type: SheetPreviewRow['type']) => rows.filter((r) => r.type === type).length;
  const toAdd = count('new') + extra.length;
  const money = (n: number) => format.number(n, { style: 'currency', currency });
  const rowText = (r: SheetPreviewRow) =>
    r.type === 'new'
      ? [
          r.newItem ? t('row.newItem') : t('row.new'),
          `× ${r.quantity}`,
          money(r.costBase ?? 0),
          r.acquired,
        ].join(' · ')
      : r.type === 'error'
        ? t(`problem.${r.error}`)
        : r.type === 'existing' && r.match
          ? t(`matchedBy.${r.match}`)
          : t(`row.${r.type}`);

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        aria-label={t('file')}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
        onChange={() => {
          setState({ step: 'idle' });
          setExtra([]);
        }}
      />
      <Button size="sm" variant="outline" onClick={check} disabled={state.step === 'checking'}>
        <FileSpreadsheet className="size-4" />
        {state.step === 'checking' ? t('checking') : t('check')}
      </Button>

      {state.step === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {t(`error.${state.error}`)}
        </p>
      )}

      {(state.step === 'preview' || state.step === 'importing') && (
        <div className="space-y-2 text-sm" role="status">
          <p>
            {t('summary', {
              added: toAdd,
              existing: rows.filter((r) => r.type === 'existing' && !r.canAdd).length,
              likely: rows.filter((r) => r.canAdd && !extra.includes(r.line)).length,
              skipped: count('skipped'),
              problems: count('error'),
            })}
          </p>
          {state.ignored.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('ignored', { columns: state.ignored.join(', ') })}
            </p>
          )}
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {rows.map((r) => (
              <li key={r.line} className="flex gap-3 px-3 py-1.5">
                <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('line', { line: r.line })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.item || '-'}</span>
                  <span
                    className={
                      r.type === 'error'
                        ? 'block text-xs text-destructive'
                        : 'block text-xs text-muted-foreground'
                    }
                  >
                    {rowText(r)}
                    {r.lotId && (
                      <>
                        {' · '}
                        <Link href={`/holdings/${r.lotId}`} target="_blank" className="underline">
                          {t('matchedLot')}
                        </Link>
                      </>
                    )}
                  </span>
                  {r.canAdd && (
                    <label className="mt-1 flex items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={extra.includes(r.line)}
                        onChange={(e) =>
                          setExtra((x) =>
                            e.target.checked ? [...x, r.line] : x.filter((l) => l !== r.line),
                          )
                        }
                      />
                      {t('addAnyway')}
                    </label>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={confirm}
              disabled={toAdd === 0 || state.step === 'importing'}
            >
              {state.step === 'importing' ? t('importing') : t('import', { count: toAdd })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState({ step: 'idle' })}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {state.step === 'done' && (
        <p role="status" className="text-sm">
          {t('done', { count: state.imported })}{' '}
          <Link href="/imports/review" className="underline">
            {t('review')}
          </Link>
          {' · '}
          <Link href={`/imports/runs/${state.runId}`} className="underline">
            {t('open')}
          </Link>
        </p>
      )}
    </div>
  );
}
