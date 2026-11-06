import { describe, expect, it } from 'vitest';
import {
  type Notice,
  type StorePostData,
  discordPayloads,
  fillText,
  noticeExamples,
  plainText,
  storeNotice,
  storeStartsExample,
  storeStartsNotice,
  telegramHtml,
} from './alert-notices';
import { toLocalIso } from './time';

const m: Notice = {
  kind: 'store',
  head: 'Tora: cards',
  link: 'https://tora.test/stores',
  linkText: 'Stores',
  urlText: 'post',
  cards: [
    {
      title: 'Megastore Minato',
      sub: 'Snow *set*',
      quote: 'a *b*\nline 2',
      when: '10-21 18:00',
      url: 'https://x.test/a_b',
      role: 'post',
    },
    { title: 'Comment to Megastore Minato', quote: '<sold out>', role: 'comment' },
  ],
};

describe('notices', () => {
  it('writes Discord cards, the data text as written', () => {
    const [discord] = discordPayloads(m);
    expect(discord).toEqual({
      content: '-# Tora: cards · <https://tora.test/stores>',
      embeds: [
        {
          title: 'Megastore Minato',
          url: 'https://x.test/a_b',
          description: '*Snow \\*set\\**\n> a \\*b\\*\n> line 2',
          footer: { text: '10-21 18:00' },
          color: 0xf59e0b,
        },
        { title: 'Comment to Megastore Minato', description: '> \\<sold out\\>', color: 0x3b82f6 },
      ],
      allowed_mentions: { parse: [] },
    });
    // More than 10 cards: more messages, the heading on the first only.
    const many = discordPayloads({ ...m, cards: Array(12).fill(m.cards[1]) });
    expect(many.map((p) => (p.embeds as unknown[]).length)).toEqual([10, 2]);
    expect(many[1]!.content).toBeUndefined();
  });

  it("follows the person's style: colors, parts left out, plain text", () => {
    const [styled] = discordPayloads(m, {
      colors: { post: '#000010' },
      hide: { head: true, when: true, quote: true },
    });
    expect(styled!.content).toBe('<https://tora.test/stores>');
    expect((styled!.embeds as Record<string, unknown>[])[0]).toEqual({
      title: 'Megastore Minato',
      url: 'https://x.test/a_b',
      description: '*Snow \\*set\\**',
      color: 16,
    });
    const [plain] = discordPayloads(m, { format: 'plain' });
    expect(plain!.content).toBe(plainText(m));
    expect(plain!.embeds).toBeUndefined();
  });

  it('keeps a quote in a link inside its Telegram href', () => {
    const html = telegramHtml({ ...m, link: 'https://tora.test/s?q="x"><b>' });
    expect(html).toContain('<a href="https://tora.test/s?q=&quot;x&quot;&gt;&lt;b&gt;">');
  });

  it('writes Telegram HTML (no colors) and plain text', () => {
    expect(telegramHtml(m)).toBe(
      [
        '<i>Tora: cards</i>',
        '<b>Megastore Minato</b>\n<i>Snow *set*</i>\n<blockquote>a *b*\nline 2</blockquote>\n<code>10-21 18:00</code> · <a href="https://x.test/a_b">post</a>',
        '<b>Comment to Megastore Minato</b>\n<blockquote>&lt;sold out&gt;</blockquote>',
        '<a href="https://tora.test/stores">Stores</a>',
      ].join('\n\n'),
    );
    expect(plainText(m)).toContain('Comment to Megastore Minato\n<sold out>');
  });

  it('groups store posts as the Now page: a card per location, a section per store', () => {
    const post = (
      key: string,
      location: string,
      store: string,
      at: string,
      extra: Partial<StorePostData> = {},
    ): StorePostData => ({
      key,
      location: { id: location, title: location, url: `https://tora.test/stores?open=${location}` },
      store,
      products: ['Snow set'],
      text: key,
      when: at.slice(11, 16),
      at,
      url: `https://b.test/${key}`,
      comment: false,
      ...extra,
    });
    const n = storeNotice(
      { storeReply: 'reply', storePosts: 'On sale' },
      [
        post('p1', 'Minato', 'Megastore Minato', '2026-10-21T18:00:00+09:00'),
        post('p2', 'Minato', 'Arcade Minato', '2026-10-21T18:05:00+09:00'),
        post('r1', 'Minato', 'Megastore Minato', '2026-10-21T18:10:00+09:00', {
          comment: true,
          thread: 'p1',
        }),
        post('r2', 'Kita', 'Kita', '2026-10-21T17:00:00+09:00', {
          comment: true,
          thread: 'p0',
          threadText: 'an earlier post\nsecond line',
        }),
      ],
      null,
    );
    // The newest location first; in it the store with the newest message (a reply counts).
    expect(n.cards.map((c) => c.title)).toEqual(['Minato', 'Kita']);
    const [minato, kita] = n.cards;
    expect(minato!.sections!.map((sec) => sec.title)).toEqual([
      'Megastore Minato',
      'Arcade Minato',
    ]);
    expect(minato!.sections![0]!.entries).toEqual([
      expect.objectContaining({
        quote: 'p1',
        replies: [expect.objectContaining({ quote: 'r1', reply: true, sub: null })],
      }),
    ]);
    expect(minato).toMatchObject({ role: 'post', replyTo: null, keys: ['p1', 'r1', 'p2'] });
    // A store alone in its location has no heading; a reply without its post shows the post's start.
    expect(kita!.sections).toEqual([
      {
        title: '',
        entries: [expect.objectContaining({ reply: true, to: 'an earlier post…' })],
      },
    ]);
    expect(kita).toMatchObject({ role: 'comment', replyTo: 'p0', keys: ['r2'] });
    expect(n.split).toBe(true);

    const [discord] = discordPayloads(n);
    const [first] = discord!.embeds as { title: string; url: string; description: string }[];
    const at = Date.parse('2026-10-21T18:00:00+09:00') / 1000;
    expect(first).toMatchObject({ title: 'Minato', url: 'https://tora.test/stores?open=Minato' });
    expect(first!.description).toContain(
      `**Megastore Minato**\n<t:${at}:t> · <t:${at}:R> · *Snow set* · [post](https://b.test/p1)\n> p1\n↳ <t:`,
    );
    expect(first!.description).toContain('[reply](https://b.test/r1)\n> r1\n\n**Arcade Minato**');
    const html = telegramHtml({ ...n, cards: [kita!] });
    expect(html).toContain('<b><a href="https://tora.test/stores?open=Kita">Kita</a></b>');
    expect(html).toContain('↳ <i>an earlier post…</i> · <code>17:00</code> · <i>Snow set</i>');
    expect(plainText(n)).toContain('Arcade Minato\n18:05 · Snow set · https://b.test/p2\np2');
    // Long posts fold on Telegram.
    const long = storeNotice(
      {},
      [post('x'.repeat(250), 'Kita', 'Kita', '2026-10-21T17:00:00+09:00')],
      null,
    );
    expect(telegramHtml(long)).toContain('<blockquote expandable>');
  });

  it('sends Discord embeds in messages Discord takes (6,000 characters)', () => {
    const card = { title: 'x', body: 'y'.repeat(3000) };
    expect(discordPayloads({ kind: 'store', cards: [card, card, card] }).length).toBe(3);
  });

  it("builds each kind from the person's texts, examples included", () => {
    const examples = noticeExamples({ test: 'Hello' }, (n) => `¥${n}`);
    expect(Object.keys(examples)).toEqual([
      'store',
      'storeUnknown',
      'feed',
      'buy',
      'summary',
      'admin',
      'test',
    ]);
    expect(examples.test.cards[0]!.body).toBe('Hello');
    expect(examples.buy.cards[0]!.body).toContain('¥48000');
  });
});

it('fills placeholders and plural counts as the messages write them', () => {
  const gone =
    '{count, plural, =0 {no listing} one {# listing was} other {# listings were}} set aside';
  expect([0, 1, 1200].map((count) => fillText(gone, { count }))).toEqual([
    'no listing set aside',
    '1 listing was set aside',
    '1,200 listings were set aside',
  ]);
  expect(
    fillText('{source}: {n, plural, one {# item from {source}} other {# items}}', {
      source: 'megastore',
      n: 1,
    }),
  ).toBe('megastore: 1 item from megastore');
  // Unknown values stay empty; braces that are no placeholder stay as written.
  expect(fillText('{a} {b} {c d}', { a: 1 })).toBe('1  {c d}');
  // A lone brace does not stop the placeholders after it.
  expect(fillText('a { {b}', { b: 'X' })).toBe('a { X');
  // Spanish forms; a missing count is 0; # inside a nested plural is that plural's own count.
  const es = '{count, plural, one {se apartó # anuncio} other {se apartaron # anuncios}}';
  expect([fillText(es, { count: 1 }), fillText(es, {})]).toEqual([
    'se apartó 1 anuncio',
    'se apartaron 0 anuncios',
  ]);
  expect(
    fillText('{a, plural, other {# in {b, plural, one {# box} other {# boxes}}}}', { a: 3, b: 1 }),
  ).toBe('3 in 1 box');
  // A plural that does not parse, has no other, or no number is kept as written.
  expect(
    [
      ['{n, plural, one {x}}', 1],
      ['{n, plural, one {x', 1],
      ['{n, plural, other {# x}}', 'many'],
    ].map(([text, n]) => fillText(String(text), { n: n! }) === text),
  ).toEqual([true, true, true]);
});

describe('a sale started notice (S29)', () => {
  const data = (over = {}) => ({
    key: 'b:1',
    location: { id: 'l1', title: 'Minato', url: 'https://tora.example/stores?open=l1' },
    store: 'Megastore Minato',
    products: ['Snow set'],
    text: `started <b>*x*</b> ${'y'.repeat(100)}\nsecond line`,
    when: '18:00',
    at: '2026-11-01T18:00:00.000+09:00',
    people: null,
    ...over,
  });
  it('is short: time, store, products, first line, the row link; escaped on both apps', () => {
    const n = storeStartsNotice({}, [data()]);
    expect(n.kind).toBe('store');
    expect(n.head).toBe('Tora: a sale has started');
    expect(n.images).toBeUndefined();
    const [payload] = discordPayloads(n) as { embeds: { url: string; description: string }[] }[];
    expect(payload!.embeds[0]!.url).toBe('https://tora.example/stores?open=l1');
    expect(payload!.embeds[0]!.description).toContain('Snow set');
    expect(payload!.embeds[0]!.description).toContain('\\*x\\*');
    expect(payload!.embeds[0]!.description).not.toContain('second line');
    expect(payload!.embeds[0]!.description).not.toContain('y'.repeat(90));
    const telegram = telegramHtml(n);
    expect(telegram).toContain('&lt;b&gt;*x*&lt;/b&gt;');
    expect(telegram).toContain('href="https://tora.example/stores?open=l1"');
    expect(telegram).toContain('<code>18:00</code>');
    expect(telegram).not.toContain('second line');
  });
  it('does not say a sale started when the message holds only bursts', () => {
    const busy = storeStartsNotice({}, [data({ people: 3 })]);
    expect(busy.head).toBe('Tora: busy at your stores');
    const mixed = storeStartsNotice({}, [data({ people: 3 }), data({ key: 'b:2' })]);
    expect(mixed.head).toBe('Tora: a sale has started');
    expect(storeStartsNotice({ storeBusy: 'Busy' }, [data({ people: 3 })]).head).toBe('Busy');
  });
  it('says how many people for a burst, with or without products', () => {
    const burst = (products: string[]) =>
      telegramHtml(storeStartsNotice({}, [data({ people: 4, products })]));
    expect(burst([])).toContain('<i>4 people in 15 minutes</i>');
    expect(burst(['Snow set'])).toContain('<i>Snow set · 4 people in 15 minutes</i>');
    const own = telegramHtml(
      storeStartsNotice({ storeBurst: '{n} in {minutes} min' }, [data({ people: 3 })]),
    );
    expect(own).toContain('3 in 15 min');
  });
  it('marks the example as a test', () => {
    const n = storeStartsExample({}, 'https://tora.example/stores');
    expect(n.head).toContain('a test');
    expect(telegramHtml(n)).toContain('X1 started');
    // The app's time zone (Tokyo by default), not UTC.
    const at = new Date('2026-11-01T03:05:00.000Z');
    const entry = storeStartsExample({}, null, at).cards[0]!.sections![0]!.entries[0]!;
    expect(entry.when).toBe('12:05');
    expect(entry.at).toBe(toLocalIso(at));
  });
  it('keeps the every post notice as it was: no note, the same line', () => {
    const { people: _, ...post } = data();
    const n = storeNotice({}, [{ ...post, url: null, comment: false }], null);
    expect(n.cards[0]!.sections![0]!.entries[0]!.sub).toBe('Snow set');
    const none = storeNotice({}, [{ ...post, products: [], url: null, comment: false }], null);
    expect(none.cards[0]!.sections![0]!.entries[0]!.sub).toBeNull();
  });
});
