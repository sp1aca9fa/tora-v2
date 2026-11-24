// A language's texts (requirements S16). A translation file may be partial: what it lacks shows in
// English, so a language can be brought in, and kept up, at its own pace. A text's number token
// (`[[name]]`) is replaced here, from the code's own constants, before anything reads the text.
import { withNumbers } from '@tora/core';
import en from '../../messages/en.json';
import { TEXT_NUMBERS } from './text-numbers';

type Tree = { [key: string]: string | Tree };

// Replaced on first use: a constant's module may import next-intl, which leads back here.
let english: Tree | undefined;
const englishTexts = () => (english ??= withNumbers(en as Tree, TEXT_NUMBERS));

/** `own` with what it lacks taken from `base`. */
function withBase(own: Tree, base: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(own)) {
    const under = base[key];
    out[key] =
      typeof value === 'object' && under && typeof under === 'object'
        ? withBase(value, under)
        : value;
  }
  return out;
}

const loaded = new Map<string, Promise<Tree>>();

/** Every text in `locale`, English where its file has none. */
export function loadMessages(locale: string): Promise<Tree> {
  if (locale === 'en') return Promise.resolve(englishTexts());
  let texts = loaded.get(locale);
  if (!texts) {
    texts = import(`../../messages/${locale}.json`).then((m) =>
      withBase(withNumbers(m.default as Tree, TEXT_NUMBERS), englishTexts()),
    );
    loaded.set(locale, texts);
    // A failed load (a token with no value) is not kept: the next request tries again.
    texts.catch(() => loaded.delete(locale));
  }
  return texts;
}
