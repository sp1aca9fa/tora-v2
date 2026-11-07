'use client';

import type { PotentialCriteria } from '@tora/core';
import { POTENTIAL_SUBJECT_CHARS, POTENTIAL_SUBJECTS } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { savePotentialAction } from '../actions';

/** What the person looks for in an item (S32): a stated preference, none tested as proven. */
export function PotentialPicker({
  rarities,
  current,
}: {
  rarities: string[];
  current: PotentialCriteria;
}) {
  const t = useTranslations('strategy');
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [subjects, setSubjects] = useState((current.subjects ?? []).join(', '));
  const [chosen, setChosen] = useState(new Set(current.rarities));
  const [outOfPrint, setOutOfPrint] = useState(!!current.outOfPrint);
  const [ranked, setRanked] = useState(!!current.ranked);
  const check = (label: string, on: boolean, set: (on: boolean) => void) => (
    <label key={label} className="flex items-center gap-2 py-1 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={on}
        onChange={(e) => {
          set(e.target.checked);
          setSaved(false);
        }}
      />
      {label}
    </label>
  );

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h2 className="font-semibold">{t('potentialTitle')}</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">{t('potentialIntro')}</p>
        <p className="max-w-2xl text-xs text-muted-foreground">{t('potentialNote')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="block space-y-1 text-sm font-medium">
            <span>{t('potentialSubjects')}</span>
            <Input
              value={subjects}
              maxLength={POTENTIAL_SUBJECTS * (POTENTIAL_SUBJECT_CHARS + 2)}
              placeholder={t('potentialSubjectsHint')}
              onChange={(e) => {
                setSubjects(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          {check(t('potentialOutOfPrint'), outOfPrint, setOutOfPrint)}
          {check(t('potentialRanked'), ranked, setRanked)}
        </div>
        {rarities.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('potentialRarities')}</legend>
            <div className="flex flex-wrap gap-x-4">
              {rarities.map((r) =>
                check(r, chosen.has(r), (on) => {
                  const next = new Set(chosen);
                  if (on) next.add(r);
                  else next.delete(r);
                  setChosen(next);
                }),
              )}
            </div>
          </fieldset>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const kept = await savePotentialAction({
                subjects: subjects.split(/[,、，\n]/),
                rarities: [...chosen],
                outOfPrint,
                ranked,
              });
              setSubjects((kept.subjects ?? []).join(', '));
              setChosen(new Set(kept.rarities ?? []));
              setSaved(true);
            })
          }
        >
          {t('potentialSave')}
        </Button>
        {saved && <span className="text-xs text-muted-foreground">{t('conditionsSaved')}</span>}
      </div>
    </section>
  );
}
