'use client';

import {
  DEFAULT_NOTICE_LEVELS,
  NOTICE_LEVELS,
  NOTICE_TYPES,
  type NoticeLevel,
  type NoticeType,
} from '@tora/core';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { LEVEL_STYLE } from '@/components/notice-level';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { submitWith } from '@/lib/submit-form';
import { type NoticeLevelsState, resetNoticeLevelsAction, saveNoticeLevelsAction } from './actions';

/** One level per notice type; the colour beside each follows the pick before saving. */
export function NoticeLevelsForm({ levels }: { levels: Record<NoticeType, NoticeLevel> }) {
  const t = useTranslations();
  const [picked, setPicked] = useState(levels);
  const [state, formAction, pending] = useActionState<NoticeLevelsState, FormData>(
    saveNoticeLevelsAction,
    {},
  );
  const changed = NOTICE_TYPES.some((type) => picked[type] !== levels[type]);
  const custom = NOTICE_TYPES.some((type) => levels[type] !== DEFAULT_NOTICE_LEVELS[type]);
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {NOTICE_LEVELS.map((level) => (
          <li key={level} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-full', LEVEL_STYLE[level].dot)} />
            {t(`notices.level.${level}`)}
          </li>
        ))}
      </ul>
      <form onSubmit={submitWith(formAction)} className="space-y-3">
        <ul className="divide-y text-sm">
          {NOTICE_TYPES.map((type) => (
            <li key={type} className="flex items-center gap-3 py-2">
              <span
                className={cn('size-2.5 shrink-0 rounded-full', LEVEL_STYLE[picked[type]].dot)}
              />
              <span className="min-w-0 flex-1">
                <span className="block">{t(`notices.type.${type}`)}</span>
                {picked[type] !== DEFAULT_NOTICE_LEVELS[type] && (
                  <span className="block text-xs text-muted-foreground">
                    {t('notices.default', {
                      level: t(`notices.level.${DEFAULT_NOTICE_LEVELS[type]}`),
                    })}
                  </span>
                )}
              </span>
              <NativeSelect
                name={type}
                value={picked[type]}
                onChange={(e) => setPicked({ ...picked, [type]: e.target.value as NoticeLevel })}
                aria-label={t(`notices.type.${type}`)}
                className="w-36"
              >
                {NOTICE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`notices.level.${level}`)}
                  </option>
                ))}
              </NativeSelect>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || !changed}>
            {t('common.save')}
          </Button>
          {custom && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                await resetNoticeLevelsAction();
                setPicked(DEFAULT_NOTICE_LEVELS);
              }}
            >
              {t('notices.reset')}
            </Button>
          )}
          {state.saved && !changed && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('notices.saved')}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
