// A failed page says so in the person's language (requirements S15), not the framework's screen.
import { NextIntlClientProvider } from 'next-intl';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import ja from '../../messages/ja.json';
import { ErrorView } from '@/components/error-view';
import GlobalError from './global-error';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

it('shows a failed page in the person’s language, with a way to try again', () => {
  const html = renderToString(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <ErrorView error={Object.assign(new Error('db'), { digest: 'abc123' })} reset={() => {}} />
    </NextIntlClientProvider>,
  );
  expect(html).toContain(ja.errorPage.title);
  expect(html).toContain(ja.errorPage.retry);
  expect(html).toContain('abc123');
});

it('shows its own page when even the root failed, in the browser’s language', () => {
  vi.stubGlobal('navigator', { language: 'ja-JP' });
  const html = renderToString(<GlobalError error={new Error('db')} reset={() => {}} />);
  expect(html).toContain('<html lang="ja"');
  expect(html).toContain('Toraを読み込めませんでした');
  vi.unstubAllGlobals();
});
