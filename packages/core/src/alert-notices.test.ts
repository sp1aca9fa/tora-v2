import { describe, expect, it } from 'vitest';
import {
  type Notice,
  discordPayloads,
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
      title: 'Yodobashi Ueno',
      sub: 'Snow *set*',
      quote: 'a *b*\nline 2',
      when: '10-21 18:00',
      url: 'https://x.test/a_b',
      role: 'post',
    },
    { title: 'Comment to Yodobashi Ueno', quote: '<sold out>', role: 'comment' },
  ],
};

describe('notices', () => {
  it('writes Discord cards, the data text as written', () => {
    const [discord] = discordPayloads(m);
    expect(discord).toEqual({
      content: '-# Tora: cards · <https://tora.test/stores>',
      embeds: [
        {
          title: 'Yodobashi Ueno',
          url: 'https://x.test/a_b',
          description: '*Snow \\*set\\**\n> a \\*b\\*\n> line 2',
          footer: { text: '10-21 18:00' },
          color: 0xf59e0b,
        },
        { title: 'Comment to Yodobashi Ueno', description: '> \\<sold out\\>', color: 0x3b82f6 },
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
      title: 'Yodobashi Ueno',
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
        '<b>Yodobashi Ueno</b>\n<i>Snow *set*</i>\n<blockquote>a *b*\nline 2</blockquote>\n<code>10-21 18:00</code> · <a href="https://x.test/a_b">post</a>',
        '<b>Comment to Yodobashi Ueno</b>\n<blockquote>&lt;sold out&gt;</blockquote>',
        '<a href="https://tora.test/stores">Stores</a>',
      ].join('\n\n'),
    );
    expect(plainText(m)).toContain('Comment to Yodobashi Ueno\n<sold out>');
  });

  it("builds each kind from the person's texts, examples included", () => {
    const n = storeNotice(
      { storeComment: 'Reply at {store}', storePosts: 'On sale' },
      [{ store: 'Ueno', products: [], text: 'x', when: '10-21 18:00', url: null, comment: true }],
      null,
    );
    expect(n.cards[0]).toMatchObject({ title: 'Reply at Ueno', role: 'comment' });
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
