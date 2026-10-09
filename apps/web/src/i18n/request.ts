import { USER_TIME_ZONE } from '@tora/core';
import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale } from './locale';

// No locale in the URL: the choice lives in a cookie (single-user app behind a login).
export default getRequestConfig(async () => {
  const locale = resolveLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get('accept-language'),
  );
  return {
    locale,
    timeZone: USER_TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
