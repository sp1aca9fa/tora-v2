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
  store: ['storePosts', 'storeReply', 'storeArea', 'storeLink', 'storeOpen'],
  storeUnknown: ['storeUnknown', 'storeLink', 'storeOpen'],
  feed: [
    'feedConnected',
    'feedBack',
    'boardBack',
    'feedGap',
    'feedSilent',
    'feedSilentStart',
    'feedSilentTracking',
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
    'sourceQuiet',
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
  /** Headed parts after the lines above (a location's stores). */
  sections?: NoticeSection[];
  /** The posts it holds, and the one they answer: Telegram sends the card as a reply to it. */
  keys?: string[];
  replyTo?: string | null;
}

/** A part of a card under its own heading (a store of a location). */
export interface NoticeSection {
  /** '' for none. */
  title: string;
  entries: NoticeEntry[];
}

/** A post in a section, its replies under it. */
export interface NoticeEntry {
  /** The products its codes stand for. */
  sub?: string | null;
  /** The post as written. */
  quote?: string | null;
  /** When, as people read it ("18:00"). */
  when?: string | null;
  /** The moment (ISO): Discord shows it in the reader's time, with how long ago kept up to date. */
  at?: string | null;
  url?: string | null;
  reply?: boolean;
  /** A reply whose post is not above it: the post's start, to know what it answers. */
  to?: string | null;
  replies?: NoticeEntry[];
}

export interface Notice {
  kind: NoticeKind;
  /** A small heading over the cards. */
  head?: string | null;
  cards: NoticeCard[];
  /** A link under everything (the app's page) and its text. */
  link?: string | null;
  linkText?: string;
  /** A card link's text (Telegram, plain text), and a reply's. */
  urlText?: string;
  replyText?: string;
  /** Each card its own message on Telegram (so a card can answer the message of its post). */
  split?: boolean;
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
  const entry = (e: NoticeEntry): NoticeEntry => ({
    ...e,
    when: hide.when ? null : e.when,
    at: hide.when ? null : e.at,
    sub: hide.sub ? null : e.sub,
    quote: hide.quote ? null : e.quote,
    to: hide.quote ? null : e.to,
    url: hide.url ? null : e.url,
    replies: e.replies?.map(entry),
  });
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
      sections: c.sections?.map((sec) => ({ ...sec, entries: sec.entries.map(entry) })),
    })),
  };
}

/** A section's posts as lines, replies under their post ("↳"), each with its quote. */
function entryLines(
  entries: NoticeEntry[],
  part: {
    to: (s: string) => string;
    when: (e: NoticeEntry) => string | null;
    sub: (s: string) => string;
    link: (url: string, text: string) => string;
    quote: (s: string) => string;
  },
  m: Notice,
): string[] {
  return entries.flatMap((e) => {
    const head = [
      e.to ? part.to(e.to) : null,
      part.when(e),
      e.sub ? part.sub(e.sub) : null,
      e.url ? part.link(e.url, e.reply ? (m.replyText ?? 'reply') : (m.urlText ?? 'post')) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return [
      ...(e.reply ? [`↳ ${head}`.trimEnd()] : head ? [head] : []),
      ...(e.quote ? [part.quote(e.quote)] : []),
      ...entryLines(e.replies ?? [], part, m),
    ];
  });
}

const colorOf = (c: NoticeCard, style?: NoticeStyle) => {
  const hex = style?.colors?.[c.role ?? 'info'] ?? DEFAULT_COLORS[c.role ?? 'info'];
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : Number.parseInt(DEFAULT_COLORS.info.slice(1), 16);
};

/** Discord Markdown escaped: a "*" in a post stays a "*". */
const mdEscape = (s: string) => s.replace(/([\\*_~`|<>[\]])/g, '\\$1').replace(/^([#-])/gm, '\\$1');
/** Embeds per Discord message, and their characters (Discord refuses over 6,000). */
const EMBEDS_PER_MESSAGE = 10;
const EMBED_CHARS = 5_800;

/** Discord's time marks: the time in the reader's zone and how long ago, kept up to date. */
function discordWhen(e: NoticeEntry): string | null {
  const ms = e.at ? Date.parse(e.at) : Number.NaN;
  if (Number.isFinite(ms)) {
    const at = Math.floor(ms / 1000);
    return `<t:${at}:t> · <t:${at}:R>`;
  }
  return e.when ? mdEscape(e.when) : null;
}

const mdQuote = (s: string) =>
  s
    .split('\n')
    .map((l) => `> ${mdEscape(l)}`)
    .join('\n');

/**
 * Discord: the heading as small text, each card an embed (title linked, colored edge), its
 * sections headed in bold; plain style: one text message.
 */
export function discordPayloads(n: Notice, style?: NoticeStyle): Record<string, unknown>[] {
  const m = styled(n, style);
  if (style?.format === 'plain') {
    return [{ content: plainText(m).slice(0, 2000), allowed_mentions: { parse: [] } }];
  }
  const embeds = m.cards.map((c) => {
    const sections = (c.sections ?? []).map((sec) =>
      [
        ...(sec.title ? [`**${mdEscape(sec.title)}**`] : []),
        ...entryLines(
          sec.entries,
          {
            to: (s) => `*${mdEscape(s)}*`,
            when: discordWhen,
            sub: (s) => `*${mdEscape(s)}*`,
            link: (url, text) => `[${mdEscape(text)}](${url.replace(/[()]/g, encodeURIComponent)})`,
            quote: mdQuote,
          },
          m,
        ),
      ].join('\n'),
    );
    const description = [
      c.sub ? `*${mdEscape(c.sub)}*` : null,
      c.body ? mdEscape(c.body) : null,
      c.quote ? mdQuote(c.quote) : null,
      sections.length ? sections.join('\n\n') : null,
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
  });
  // As many embeds per message as Discord takes.
  const batches: (typeof embeds)[] = [];
  let chars = 0;
  for (const e of embeds) {
    const size =
      (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0);
    const last = batches.at(-1);
    if (last && last.length < EMBEDS_PER_MESSAGE && chars + size <= EMBED_CHARS) {
      last.push(e);
      chars += size;
    } else {
      batches.push([e]);
      chars = size;
    }
  }
  const head = [m.head ? `-# ${mdEscape(m.head)}` : null, m.link ? `<${m.link}>` : null]
    .filter(Boolean)
    .join(' · ');
  return (batches.length ? batches : [[]]).map((batch, i) => ({
    ...(i === 0 && head ? { content: head } : {}),
    embeds: batch,
    allowed_mentions: { parse: [] },
  }));
}

const htmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A quote this long or longer is folded on Telegram (opened with a tap). */
const FOLD_CHARS = 200;
const FOLD_LINES = 4;

const htmlQuote = (s: string) =>
  `<blockquote${s.length >= FOLD_CHARS || s.split('\n').length >= FOLD_LINES ? ' expandable' : ''}>${htmlEscape(s)}</blockquote>`;

/**
 * Telegram's HTML: the title bold (linked when the card has sections), the line under it in
 * italics, the text quoted, long quotes folded (no colors).
 */
export function telegramHtml(n: Notice, style?: NoticeStyle): string {
  const m = styled(n, style);
  const cards = m.cards.map((c) =>
    [
      c.title
        ? c.sections && c.url
          ? `<b><a href="${htmlEscape(c.url)}">${htmlEscape(c.title)}</a></b>`
          : `<b>${htmlEscape(c.title)}</b>`
        : null,
      c.sub ? `<i>${htmlEscape(c.sub)}</i>` : null,
      c.body ? htmlEscape(c.body) : null,
      c.quote ? htmlQuote(c.quote) : null,
      [
        c.when ? `<code>${htmlEscape(c.when)}</code>` : null,
        c.url && !c.sections
          ? `<a href="${htmlEscape(c.url)}">${htmlEscape(m.urlText ?? 'link')}</a>`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
      ...(c.sections ?? []).map((sec) =>
        [
          sec.title ? `\n<u>${htmlEscape(sec.title)}</u>` : '',
          ...entryLines(
            sec.entries,
            {
              to: (s) => `<i>${htmlEscape(s)}</i>`,
              when: (e) => (e.when ? `<code>${htmlEscape(e.when)}</code>` : null),
              sub: (s) => `<i>${htmlEscape(s)}</i>`,
              link: (url, text) => `<a href="${htmlEscape(url)}">${htmlEscape(text)}</a>`,
              quote: htmlQuote,
            },
            m,
          ),
        ].join('\n'),
      ),
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
      [
        c.title,
        c.sub,
        c.body,
        c.quote,
        [c.when, c.url].filter(Boolean).join(' '),
        ...(c.sections ?? []).map((sec) =>
          [
            sec.title ? `\n${sec.title}` : '',
            ...entryLines(
              sec.entries,
              {
                to: (s) => s,
                when: (e) => e.when ?? null,
                sub: (s) => s,
                link: (url) => url,
                quote: (s) => s,
              },
              m,
            ),
          ].join('\n'),
        ),
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    ...(m.link ? [m.link] : []),
  ].join('\n\n');
}

// ---- Builders: each kind's notice from its data and the person's texts ----

export interface StorePostData {
  /** The post's key (its board and id) and, a reply, its first post's. */
  key: string;
  thread?: string | null;
  /** Its location (a card) and its store there (a section): one each per store it names. */
  location: { id: string; title: string; url: string | null };
  /** The store as the person reads it ("Megastore Ekimae"). */
  store: string;
  products: string[];
  text: string;
  /** "18:00", and the moment (ISO). */
  when: string;
  at?: string | null;
  url: string | null;
  /** A reply to a post. */
  comment: boolean;
  /** A reply: its first post's text. */
  threadText?: string | null;
}

/** A reply's first post, as its start ("KTA 雪(1)…"). */
const startOf = (text: string) => {
  const line = text.trim().split('\n')[0]!;
  return line.length > 40 || text.trim().includes('\n') ? `${line.slice(0, 40)}…` : line;
};

/**
 * Store posts as the Now page shows them: a card per location, the newest first, a section per
 * store, its posts the newest first with their replies under them; a reply whose post is not in the
 * notice shows that post's start. On Telegram each card is a message, a card of replies to one
 * post answering that post's message.
 */
export function storeNotice(t: NoticeTexts, posts: StorePostData[], link: string | null): Notice {
  const latest = (e: NoticeEntry): string =>
    [e.at ?? e.when ?? '', ...(e.replies ?? []).map(latest)].sort().at(-1)!;
  const byLocation = new Map<
    string,
    { data: StorePostData; stores: Map<string, StorePostData[]> }
  >();
  for (const p of posts) {
    const loc = byLocation.get(p.location.id) ?? { data: p, stores: new Map() };
    byLocation.set(p.location.id, loc);
    loc.stores.set(p.store, [...(loc.stores.get(p.store) ?? []), p]);
  }
  const cards = [...byLocation.values()].map(({ data, stores }) => {
    const sections = [...stores].map(([store, list]) => {
      const entry = (p: StorePostData): NoticeEntry => ({
        sub: p.products.length ? p.products.join(', ') : null,
        quote: p.text,
        when: p.when,
        at: p.at ?? null,
        url: p.url,
        ...(p.comment ? { reply: true } : {}),
      });
      const top = new Map<string, NoticeEntry>();
      for (const p of list.filter((p) => !p.comment)) top.set(p.key, { ...entry(p), replies: [] });
      const loose: NoticeEntry[] = [];
      for (const p of list.filter((p) => p.comment)) {
        const parent = p.thread ? top.get(p.thread) : undefined;
        // Under its post, the products only when they differ from the post's.
        if (parent)
          parent.replies!.push({
            ...entry(p),
            ...(p.products.join(', ') === parent.sub && { sub: null }),
          });
        else loose.push({ ...entry(p), to: p.threadText ? startOf(p.threadText) : null });
      }
      const entries = [...top.values(), ...loose].sort((a, b) =>
        latest(b).localeCompare(latest(a)),
      );
      for (const e of entries) e.replies?.sort((a, b) => latest(a).localeCompare(latest(b)));
      return { title: store, entries, latest: latest({ replies: entries }) };
    });
    sections.sort((a, b) => b.latest.localeCompare(a.latest));
    const all = [...stores.values()].flat();
    // Replies only, all to one post: Telegram answers its message.
    const threads = new Set(all.map((p) => (p.comment ? p.thread : null)));
    return {
      card: {
        title: data.location.title,
        url: data.location.url,
        // A store alone in its own location: no heading repeating the card's.
        sections: sections.map(({ title, entries }) => ({
          title: sections.length === 1 && title === data.location.title ? '' : title,
          entries,
        })),
        keys: [...new Set(all.map((p) => p.key))],
        replyTo: threads.size === 1 ? ([...threads][0] ?? null) : null,
        role: all.some((p) => !p.comment) ? 'post' : 'comment',
      } satisfies NoticeCard,
      latest: sections[0]?.latest ?? '',
    };
  });
  cards.sort((a, b) => b.latest.localeCompare(a.latest));
  return {
    kind: 'store',
    head: t.storePosts ?? 'Tora: cards on sale in your area',
    link,
    linkText: t.storeLink ?? 'Store notices in Tora',
    urlText: t.storeOpen ?? 'post',
    replyText: t.storeReply ?? 'reply',
    split: true,
    cards: cards.map((c) => c.card),
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
  now = new Date(),
): Record<NoticeKind, Notice> {
  const link = 'https://tora.example/stores';
  return {
    store: storeNotice(
      t,
      [
        {
          key: 'b:1',
          location: { id: 'l1', title: 'Minato', url: `${link}?open=l1` },
          store: 'Megastore Minato',
          products: ['9 card sets'],
          text: 'X1 9種●',
          when: '18:00',
          at: new Date(now.getTime() - 15 * 60_000).toISOString(),
          url: 'https://board.example/#1',
          comment: false,
        },
        {
          key: 'b:2',
          thread: 'b:1',
          location: { id: 'l1', title: 'Minato', url: `${link}?open=l1` },
          store: 'Megastore Minato',
          products: ['9 card sets'],
          text: 'まだ並んでる 40人くらい',
          when: '18:12',
          at: new Date(now.getTime() - 3 * 60_000).toISOString(),
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
