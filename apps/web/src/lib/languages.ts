import 'server-only';
import type { LanguageSettings } from '@tora/core';
import { cache } from 'react';
import { appLanguages } from '@/i18n/locale';
import { getRegistry } from './sources';

/** The app's primary and secondary language (admin, S16), read once per request. */
export const getLanguages = cache(async (): Promise<LanguageSettings> =>
  appLanguages((await getRegistry()).languages),
);
