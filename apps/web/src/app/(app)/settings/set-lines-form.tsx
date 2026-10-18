'use client';

import { SET_LINES } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { saveSetLinesAction } from './actions';

/** The admin's list of set lines (S9): the built-in ones to keep, and their own. */
export function SetLinesForm({ lines }: { lines: string[] }) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [kept, setKept] = useState(SET_LINES.filter((l) => lines.includes(l)) as string[]);
  const [others, setOthers] = useState(
    lines.filter((l) => !(SET_LINES as readonly string[]).includes(l)).join('\n'),
  );
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          await saveSetLinesAction([...kept, ...others.split('\n')]);
          setSaved(true);
        });
      }}
    >
      <fieldset className="space-y-1">
        <legend className="font-medium">{t('setLines.builtIn')}</legend>
        {SET_LINES.map((l) => (
          <label key={l} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={kept.includes(l)}
              onChange={(e) => {
                setSaved(false);
                setKept((k) => (e.target.checked ? [...k, l] : k.filter((x) => x !== l)));
              }}
            />
            {t(`lines.${l}`)}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <span className="font-medium">{t('setLines.others')}</span>
        <Textarea
          rows={3}
          value={others}
          onChange={(e) => {
            setSaved(false);
            setOthers(e.target.value);
          }}
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t('common.save')}
        </Button>
        {saved && <span className="text-muted-foreground">{t('setLines.saved')}</span>}
      </div>
    </form>
  );
}
