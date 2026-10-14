import { USER_TIME_ZONE, pickLocale } from '@tora/core';
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { getLanguages } from '@/lib/languages';
import { LOCALE_COOKIE } from './locale';

// No locale in the URL: the choice lives in a cookie, between the admin's two languages (S16);
// each page loads only its language's texts.
export default getRequestConfig(async () => {
  const [jar, languages] = await Promise.all([cookies(), getLanguages()]);
  const locale = pickLocale(jar.get(LOCALE_COOKIE)?.value, languages);
  return {
    locale,
    timeZone: USER_TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
