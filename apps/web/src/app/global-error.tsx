'use client';

/**
 * Even the root failed (the database did not answer while the app's languages were read): no
 * texts are loaded, so this page carries its own few, in the browser's language when it has them.
 */
const TEXT = {
  en: {
    title: 'Tora could not load',
    info: 'The server or its database did not answer. Try again in a moment.',
    retry: 'Try again',
  },
  ja: {
    title: 'Toraを読み込めませんでした',
    info: 'サーバーまたはデータベースが応答しませんでした。少し待ってからもう一度お試しください。',
    retry: 'もう一度',
  },
  es: {
    title: 'Tora no pudo cargar',
    info: 'El servidor o su base de datos no respondió. Inténtalo de nuevo en un momento.',
    retry: 'Reintentar',
  },
};

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const lang = typeof navigator === 'undefined' ? 'en' : navigator.language.slice(0, 2);
  const t = TEXT[lang as keyof typeof TEXT] ?? TEXT.en;
  return (
    <html lang={lang in TEXT ? lang : 'en'}>
      <body
        style={{ fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: '3rem 1rem' }}
      >
        <h1 style={{ fontSize: '1.125rem' }}>{t.title}</h1>
        <p style={{ color: '#666', fontSize: '0.875rem' }}>{t.info}</p>
        <button type="button" onClick={() => reset()} style={{ padding: '0.4rem 0.9rem' }}>
          {t.retry}
        </button>
      </body>
    </html>
  );
}
