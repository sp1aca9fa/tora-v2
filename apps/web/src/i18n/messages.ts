// A language's texts (requirements S16). A translation file may be partial: what it lacks shows in
// English, so a language can be brought in, and kept up, at its own pace.
import en from '../../messages/en.json';

type Tree = { [key: string]: string | Tree };

const english = en as Tree;

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
  if (locale === 'en') return Promise.resolve(english);
  let texts = loaded.get(locale);
  if (!texts) {
    texts = import(`../../messages/${locale}.json`).then((m) =>
      withBase(m.default as Tree, english),
    );
    loaded.set(locale, texts);
  }
  return texts;
}
