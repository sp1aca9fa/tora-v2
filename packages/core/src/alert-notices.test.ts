import { describe, expect, it } from 'vitest';
import {
  type Notice,
  type StorePostData,
  discordPayloads,
  fillText,
  noticeExamples,
  plainText,
  storeNotice,
  telegramHtml,
} from './alert-notices';

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
});
