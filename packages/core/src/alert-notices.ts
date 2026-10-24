// Notices sent to Discord and Telegram (S17, S25; styles: 2026-10-21): one structure for every
// kind (a heading, cards, a link), built from the person's texts; each person styles them per
// kind (cards or plain text, colors, which parts show) and words them (texts with {placeholders}).
// The same builders and renderers make the previews on Settings > Alerts > Customize notices.

export const NOTICE_KINDS = [
  'store',
  'storeUnknown',
  'feed',
  'buy',
  'summary',
  'admin',
  'test',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** What a card is about: its color on Discord. */
export const NOTICE_ROLES = [
  'post',
  'comment',
  'unknown',
  'info',
  'good',
  'warning',
  'bad',
] as const;
export type NoticeRole = (typeof NOTICE_ROLES)[number];

export const DEFAULT_COLORS: Record<NoticeRole, string> = {
  post: '#f59e0b',
  comment: '#3b82f6',
  unknown: '#a855f7',
  info: '#64748b',
  good: '#10b981',
  warning: '#eab308',
  bad: '#ef4444',
};

/** The roles each kind's cards use (the colors its style can set). */
export const NOTICE_KIND_ROLES: Record<NoticeKind, NoticeRole[]> = {
  store: ['post', 'comment'],
  storeUnknown: ['unknown'],
  feed: ['info', 'warning'],
  buy: ['good'],
  summary: ['info', 'warning'],
  admin: ['bad', 'warning'],
  test: ['info'],
};

/** The texts each kind uses (keys of the `alertText` messages), for the wording editor. */
export const NOTICE_TEXTS: Record<NoticeKind, string[]> = {
  store: ['storePosts', 'storeComment', 'storeArea', 'storeLink', 'storeOpen'],
  storeUnknown: ['storeUnknown', 'storeLink', 'storeOpen'],
  feed: [
    'feedConnected',
    'feedBack',
    'boardBack',
    'feedGap',
    'feedSilent',
    'feedSilentStart',
    'feedStillSilent',
    'boardSilent',
  ],
  buy: ['buyTitle', 'buyZone', 'buyLimited', 'buyTarget'],
  summary: [
    'summaryTitle',
    'summaryImport',
    'summaryActions',
    'summaryDrops',
    'summaryDrop',
    'method_email',
  ],
  admin: [
    'collectFailed',
    'collectStopped',
    'sourceLine',
    'backupFailed',
    'noCollect',
    'noBackup',
    'dbBudget',
    'selfCheck',
    'updateFailed',
    'logHint',
  ],
  test: ['test', 'connected'],
};

/** Parts of a notice a style can leave out. */
export const NOTICE_PARTS = ['head', 'when', 'sub', 'quote', 'url', 'link'] as const;
export type NoticePart = (typeof NOTICE_PARTS)[number];

export interface NoticeCard {
  /** The card's first line (bold). */
  title?: string | null;
  /** Under the title, in italics (e.g. the products). */
  sub?: string | null;
  /** Plain lines. */
  body?: string | null;
  /** Text as written somewhere else (a post), quoted. */
  quote?: string | null;
  /** When, as people read it ("10-21 18:00"). */
  when?: string | null;
  /** The card's page (its title links to it on Discord). */
  url?: string | null;
  role?: NoticeRole;
}

export interface Notice {
  kind: NoticeKind;
  /** A small heading over the cards. */
  head?: string | null;
  cards: NoticeCard[];
  /** A link under everything (the app's page) and its text. */
  link?: string | null;
  linkText?: string;
  /** A card link's text (Telegram, plain text). */
  urlText?: string;
  /** Pictures sent after the text (Discord and Telegram). */
  images?: NoticeImage[];
}

export interface NoticeImage {
  /** The file's name ("362152-1.jpeg"). */
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface NoticeStyle {
  /** Cards (Discord embeds, Telegram formatting) or plain text. */
  format?: 'cards' | 'plain';
  /** Discord colors per role ("#f59e0b"). Telegram has no colors. */
  colors?: Partial<Record<NoticeRole, string>>;
  /** Parts left out. */
  hide?: Partial<Record<NoticePart, boolean>>;
}

/** A person's notice styles per kind, and their own wording per language (texts by key). */
export interface NoticePrefs {
  styles?: Partial<Record<NoticeKind, NoticeStyle>>;
  texts?: Record<string, Record<string, string>>;
}

export type NoticeTexts = Record<string, string>;

/** Fills {placeholders}; a placeholder with no value stays empty. */
export const fillText = (text: string, params: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));

/** The notice with the parts its style leaves out removed. */
export function styled(n: Notice, style?: NoticeStyle): Notice {
  const hide = style?.hide ?? {};
  return {
    ...n,
    head: hide.head ? null : n.head,
    link: hide.link ? null : n.link,
    cards: n.cards.map((c) => ({
      ...c,
      when: hide.when ? null : c.when,
      sub: hide.sub ? null : c.sub,
      quote: hide.quote ? null : c.quote,
      url: hide.url ? null : c.url,
    })),
  };
}

const colorOf = (c: NoticeCard, style?: NoticeStyle) => {
  const hex = style?.colors?.[c.role ?? 'info'] ?? DEFAULT_COLORS[c.role ?? 'info'];
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : Number.parseInt(DEFAULT_COLORS.info.slice(1), 16);
};

/** Discord Markdown escaped: a "*" in a post stays a "*". */
const mdEscape = (s: string) => s.replace(/([\\*_~`|<>[\]])/g, '\\$1').replace(/^([#-])/gm, '\\$1');
/** Embeds per Discord message. */
const EMBEDS_PER_MESSAGE = 10;

/**
 * Discord: the heading as small text, each card an embed (title linked, colored edge); plain
 * style: one text message.
 */
export function discordPayloads(n: Notice, style?: NoticeStyle): Record<string, unknown>[] {
  const m = styled(n, style);
  if (style?.format === 'plain') {
    return [{ content: plainText(m).slice(0, 2000), allowed_mentions: { parse: [] } }];
  }
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.max(1, m.cards.length); i += EMBEDS_PER_MESSAGE) {
    const head = [m.head ? `-# ${mdEscape(m.head)}` : null, m.link ? `<${m.link}>` : null]
      .filter(Boolean)
      .join(' · ');
    out.push({
      ...(i === 0 && head ? { content: head } : {}),
      embeds: m.cards.slice(i, i + EMBEDS_PER_MESSAGE).map((c) => {
        const description = [
          c.sub ? `*${mdEscape(c.sub)}*` : null,
          c.body ? mdEscape(c.body) : null,
          c.quote
            ? c.quote
                .split('\n')
                .map((l) => `> ${mdEscape(l)}`)
                .join('\n')
            : null,
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 4000);
        return {
          ...(c.title ? { title: c.title.slice(0, 256) } : {}),
          ...(c.url && c.title ? { url: c.url } : {}),
          ...(description ? { description } : {}),
          ...(c.when ? { footer: { text: c.when } } : {}),
          color: colorOf(c, style),
        };
      }),
      allowed_mentions: { parse: [] },
    });
  }
  return out;
}

const htmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram's HTML: the title bold, the line under it in italics, the text quoted (no colors). */
export function telegramHtml(n: Notice, style?: NoticeStyle): string {
  const m = styled(n, style);
  const cards = m.cards.map((c) =>
    [
      c.title ? `<b>${htmlEscape(c.title)}</b>` : null,
      c.sub ? `<i>${htmlEscape(c.sub)}</i>` : null,
      c.body ? htmlEscape(c.body) : null,
      c.quote ? `<blockquote>${htmlEscape(c.quote)}</blockquote>` : null,
      [
        c.when ? `<code>${htmlEscape(c.when)}</code>` : null,
        c.url ? `<a href="${htmlEscape(c.url)}">${htmlEscape(m.urlText ?? 'link')}</a>` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return [
    ...(m.head ? [`<i>${htmlEscape(m.head)}</i>`] : []),
    ...cards,
    ...(m.link ? [`<a href="${htmlEscape(m.link)}">${htmlEscape(m.linkText ?? m.link)}</a>`] : []),
  ].join('\n\n');
}

/** Plain text: every part on its own line, links written out. */
export function plainText(n: Notice, style?: NoticeStyle): string {
  const m = styled(n, style);
  return [
    ...(m.head ? [m.head] : []),
    ...m.cards.map((c) =>
      [c.title, c.sub, c.body, c.quote, [c.when, c.url].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join('\n'),
    ),
    ...(m.link ? [m.link] : []),
  ].join('\n\n');
}

// ---- Builders: each kind's notice from its data and the person's texts ----

export interface StorePostData {
  /** The store as the person reads it ("Megastore Ekimae"). */
  store: string;
  products: string[];
  text: string;
  when: string;
  url: string | null;
  /** A reply to a post. */
  comment: boolean;
}

export function storeNotice(t: NoticeTexts, posts: StorePostData[], link: string | null): Notice {
  return {
    kind: 'store',
    head: t.storePosts ?? 'Tora: cards on sale in your area',
    link,
    linkText: t.storeLink ?? 'Store notices in Tora',
    urlText: t.storeOpen ?? 'post',
    cards: posts.map((p) => ({
      title: p.comment
        ? fillText(t.storeComment ?? 'Comment to {store}', { store: p.store })
        : p.store,
      sub: p.products.length ? p.products.join(', ') : null,
      quote: p.text,
      when: p.when,
      url: p.url,
      role: p.comment ? 'comment' : 'post',
    })),
  };
}

export function storeUnknownNotice(
  t: NoticeTexts,
  posts: { author: string | null; text: string; when: string; url: string | null }[],
  link: string | null,
): Notice {
  return {
    kind: 'storeUnknown',
    head:
      t.storeUnknown ?? 'Tora: posts naming no store Tora knows (add the code on the Stores page):',
    link,
    linkText: t.storeLink ?? 'Store notices in Tora',
    urlText: t.storeOpen ?? 'post',
    cards: posts.map((p) => ({
      title: p.author,
      quote: p.text,
      when: p.when,
      url: p.url,
      role: 'unknown',
    })),
  };
}

/** Lines of one kind (feed status, admin alerts): a card each, its role per line. */
export function linesNotice(
  kind: NoticeKind,
  head: string | null,
  lines: { text: string; role?: NoticeRole; url?: string | null; title?: string | null }[],
  link: string | null,
  linkText?: string,
): Notice {
  return {
    kind,
    head,
    link,
    linkText,
    cards: lines.map((l) => ({
      title: l.title ?? null,
      body: l.text,
      url: l.url ?? null,
      role: l.role,
    })),
  };
}

export interface BuyAlertData {
  name: string;
  /** Good price: the price and the zone's top; target: the ask, its source and the target. */
  zone?: { price: string; zone: string; limited: boolean };
  target?: { price: string; source: string; target: string };
  url: string | null;
}

export function buyNotice(t: NoticeTexts, items: BuyAlertData[]): Notice {
  // The name is the card's title: a text starting with it does not repeat it.
  const untitled = (name: string, text: string) =>
    text.startsWith(name) ? text.slice(name.length).replace(/^[\s:：,、-]+/, '') : text;
  return {
    kind: 'buy',
    head: t.buyTitle ?? 'Tora: buy timing',
    urlText: t.storeOpen ?? 'link',
    cards: items.map((i) => ({
      title: i.name,
      body: untitled(
        i.name,
        i.zone
          ? fillText(t.buyZone ?? '{name}: good price, {price} (buy zone under {zone}).', {
              name: i.name,
              price: i.zone.price,
              zone: i.zone.zone,
            }) + (i.zone.limited ? ` ${t.buyLimited ?? ''}` : '')
          : fillText(
              t.buyTarget ?? '{name}: an ask at {price} ({source}), under your target {target}.',
              {
                name: i.name,
                price: i.target!.price,
                source: i.target!.source,
                target: i.target!.target,
              },
            ),
      ),
      url: i.url,
      role: 'good',
    })),
  };
}

// ---- Examples for the previews ----

/** Each kind with example data, in the person's texts (the previews on the settings page). */
export function noticeExamples(
  t: NoticeTexts,
  money: (n: number) => string,
): Record<NoticeKind, Notice> {
  const link = 'https://tora.example/stores';
  return {
    store: storeNotice(
      t,
      [
        {
          store: 'Megastore Minato',
          products: ['9 card sets'],
          text: 'X1 9種●',
          when: '10-21 18:00',
          url: 'https://board.example/#1',
          comment: false,
        },
        {
          store: 'Megastore Minato',
          products: ['9 card sets'],
          text: 'まだ並んでる 40人くらい',
          when: '10-21 18:12',
          url: 'https://board.example/#2',
          comment: true,
        },
      ],
      link,
    ),
    storeUnknown: storeUnknownNotice(
      t,
      [
        {
          author: 'みかん箱',
          text: '▲ カードセット開始',
          when: '10-21 18:30',
          url: 'https://board.example/#3',
        },
      ],
      link,
    ),
    feed: linesNotice(
      'feed',
      null,
      [
        {
          text: fillText(t.feedConnected ?? '', {
            source: 'myboard',
            boards: 'megastore, arcade',
          }),
          role: 'info',
        },
        {
          text: fillText(t.feedSilent ?? '', {
            source: 'myboard',
            since: '10-21 14:02',
            minutes: 12,
          }),
          role: 'warning',
        },
      ],
      link,
      t.storeLink,
    ),
    buy: buyNotice(t, [
      {
        name: 'ポケモンカード151 BOX',
        zone: { price: money(48000), zone: money(50000), limited: false },
        url: 'https://tora.example/products/1/buy',
      },
      {
        name: 'テラスタルフェスex BOX',
        target: { price: money(18500), source: 'SNKRDUNK', target: money(19000) },
        url: 'https://tora.example/products/2/buy',
      },
    ]),
    summary: linesNotice(
      'summary',
      t.summaryTitle ?? 'Tora: daily summary',
      [
        {
          text: fillText(t.summaryImport ?? '', {
            method: t.method_email ?? 'Order emails',
            imported: 4,
            existing: 2,
            skipped: 1,
            problem: 0,
          }),
          role: 'info',
          url: 'https://tora.example/imports',
        },
        {
          text: fillText(t.summaryActions ?? '', { count: 3 }),
          role: 'info',
          url: 'https://tora.example/actions',
        },
        {
          title: t.summaryDrops ?? 'Sharp drops (15% or more in a week):',
          text: fillText(t.summaryDrop ?? '', {
            name: 'バトルパートナーズ BOX',
            price: money(9800),
            pct: '-17%',
          }),
          role: 'warning',
        },
      ],
      null,
    ),
    admin: linesNotice(
      'admin',
      null,
      [
        { text: fillText(t.backupFailed ?? '', { error: 'disk full' }), role: 'bad' },
        { text: fillText(t.noCollect ?? '', { hours: 27, last: '10-20 00:05' }), role: 'warning' },
      ],
      null,
    ),
    test: linesNotice(
      'test',
      null,
      [{ text: t.test ?? 'Tora: test message.', role: 'info' }],
      null,
    ),
  };
}
