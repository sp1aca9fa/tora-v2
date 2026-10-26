import { appTimeZone, pickLocale } from '@tora/core';
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { getLanguages } from '@/lib/languages';
import { getRegistry } from '@/lib/sources';
import { withTaxonomy } from '@/lib/taxonomy-messages';
import { LOCALE_COOKIE } from './locale';
import { loadMessages } from './messages';

// No locale in the URL: the choice lives in a cookie, between the admin's two languages (S16);
// each page loads only its language's texts (English where the language has none).
export default getRequestConfig(async () => {
  const [jar, languages, registry] = await Promise.all([cookies(), getLanguages(), getRegistry()]);
  const locale = pickLocale(jar.get(LOCALE_COOKIE)?.value, languages);
  const messages = await loadMessages(locale);
  return {
    locale,
    // The admin's time zone (S16 part 5).
    timeZone: registry.timeZone ?? appTimeZone(),
    // The admin's category names (S16) join the language's texts.
    messages: registry.taxonomy ? withTaxonomy(messages, registry.taxonomy, locale) : messages,
  };
});
