'use client';

import {
  DEFAULT_COLORS,
  NOTICE_KINDS,
  NOTICE_KIND_ROLES,
  NOTICE_PARTS,
  NOTICE_TEXTS,
  type Notice,
  type NoticeKind,
  type NoticePart,
  type NoticeStyle,
  noticeExamples,
  plainText,
  styled,
} from '@tora/core';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { useMoney } from '@/components/money-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { saveNoticeStyleAction, sendNoticeExampleAction } from '../actions';

type Texts = Record<string, string>;

/**
 * Customize notices: each kind of message with example data, as Discord and Telegram show it, and
 * its look (cards or plain text, colors, parts) and wording; the previews follow every change.
 */
export function NoticeStyler({
  base,
  own,
  styles,
}: {
  /** The app's texts in the person's notice language. */
  base: Texts;
  /** The person's own wording in that language. */
  own: Texts;
  styles: Partial<Record<NoticeKind, NoticeStyle>>;
}) {
  const t = useTranslations('alertStyle');
  const money = useMoney();
  const [kind, setKind] = useState<NoticeKind>('store');
  const [allStyles, setStyles] = useState(styles);
  const [words, setWords] = useState<Texts>(own);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const style = allStyles[kind] ?? {};
  const texts = useMemo(() => ({ ...base, ...words }), [base, words]);
  const notice = useMemo(() => noticeExamples(texts, money)[kind], [texts, money, kind]);
  const setStyle = (next: NoticeStyle) => setStyles({ ...allStyles, [kind]: next });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {NOTICE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setMessage(null);
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              k === kind
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`kind.${k}`)}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t(`kindInfo.${kind}`)}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Discord</h3>
          <DiscordPreview notice={notice} style={style} />
        </section>
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            Telegram <span className="font-normal">· {t('noColors')}</span>
          </h3>
          <TelegramPreview notice={notice} style={style} />
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t('look')}</h3>
          <div className="flex gap-1.5">
            {(['cards', 'plain'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStyle({ ...style, format: f === 'plain' ? 'plain' : undefined })}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs',
                  (style.format ?? 'cards') === f
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'text-muted-foreground',
                )}
              >
                {t(`format.${f}`)}
              </button>
            ))}
          </div>
          {style.format !== 'plain' && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t('colors')}</p>
              <div className="flex flex-wrap gap-3">
                {NOTICE_KIND_ROLES[kind].map((role) => (
                  <label key={role} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="color"
                      value={style.colors?.[role] ?? DEFAULT_COLORS[role]}
                      onChange={(e) =>
                        setStyle({ ...style, colors: { ...style.colors, [role]: e.target.value } })
                      }
                      className="h-7 w-9 cursor-pointer rounded border bg-transparent"
                    />
                    {t(`role.${role}`)}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('parts')}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {NOTICE_PARTS.map((part: NoticePart) => (
                <label key={part} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={!style.hide?.[part]}
                    onChange={(e) =>
                      setStyle({ ...style, hide: { ...style.hide, [part]: !e.target.checked } })
                    }
                  />
                  {t(`part.${part}`)}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t('wording')}</h3>
          <p className="text-xs text-muted-foreground">
            {t.rich('wordingInfo', { c: (chunks) => <code>{chunks}</code> })}
          </p>
          {NOTICE_TEXTS[kind].map((key) => {
            const params = [...new Set((base[key] ?? '').match(/\{\w+\}/g) ?? [])];
            return (
              <label key={key} className="block space-y-1">
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{key}</span>
                  {words[key] !== undefined && (
                    <button
                      type="button"
                      className="text-muted-foreground underline"
                      onClick={() => {
                        const { [key]: _, ...rest } = words;
                        setWords(rest);
                      }}
                    >
                      {t('default')}
                    </button>
                  )}
                </span>
                <Textarea
                  rows={2}
                  value={words[key] ?? base[key] ?? ''}
                  onChange={(e) => setWords({ ...words, [key]: e.target.value })}
                  className="min-h-0 text-sm"
                />
                {params.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {t.rich('placeholders', {
                      list: params.join(' '),
                      c: (chunks) => <code>{chunks}</code>,
                    })}
                  </span>
                )}
              </label>
            );
          })}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveNoticeStyleAction(kind, style, kindWords(kind, words, base));
              setMessage(r.error ? t('error') : t('saved'));
            })
          }
        >
          {t('save')}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            const rest = { ...words };
            for (const key of NOTICE_TEXTS[kind]) delete rest[key];
            setWords(rest);
            setStyles({ ...allStyles, [kind]: {} });
            setMessage(t('resetHint'));
          }}
        >
          {t('reset')}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await sendNoticeExampleAction(kind);
              setMessage(
                r.error ? t('error') : r.sent ? t('sent', { count: r.sent }) : t('noChannels'),
              );
            })
          }
        >
          {t('sendExample')}
        </Button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}

/** The kind's own wording that differs from the app's (what is saved). */
function kindWords(kind: NoticeKind, words: Texts, base: Texts): Texts {
  return Object.fromEntries(
    NOTICE_TEXTS[kind].flatMap((key) =>
      words[key] !== undefined && words[key] !== base[key] ? [[key, words[key]!]] : [],
    ),
  );
}

/** A Discord message as Discord shows it: the small heading, then each card as an embed. */
function DiscordPreview({ notice, style }: { notice: Notice; style: NoticeStyle }) {
  const m = styled(notice, style);
  return (
    <div className="space-y-2 rounded-lg bg-[#313338] p-3 text-[13px] leading-snug text-[#dbdee1]">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-white">Tora</span>
        <span className="rounded bg-[#5865f2] px-1 text-[10px] font-medium text-white">APP</span>
      </div>
      {style.format === 'plain' ? (
        <p className="whitespace-pre-wrap break-words">{plainText(notice, style)}</p>
      ) : (
        <>
          {(m.head || m.link) && (
            <p className="text-[11px] text-[#949ba4]">
              {m.head}
              {m.head && m.link && ' · '}
              {m.link && <span className="text-[#00a8fc]">{m.link}</span>}
            </p>
          )}
          {m.cards.map((c, i) => (
            <div
              key={i}
              className="max-w-md space-y-1 rounded border-l-4 bg-[#2b2d31] px-3 py-2"
              style={{
                borderLeftColor:
                  style.colors?.[c.role ?? 'info'] ?? DEFAULT_COLORS[c.role ?? 'info'],
              }}
            >
              {c.title && (
                <p className={cn('font-semibold', c.url ? 'text-[#00a8fc]' : 'text-white')}>
                  {c.title}
                </p>
              )}
              {c.sub && <p className="italic">{c.sub}</p>}
              {c.body && <p className="whitespace-pre-wrap break-words">{c.body}</p>}
              {c.quote && (
                <p className="border-l-4 border-[#4e5058] pl-2 whitespace-pre-wrap break-words">
                  {c.quote}
                </p>
              )}
              {c.when && <p className="text-[11px] text-[#949ba4]">{c.when}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** A Telegram message as Telegram shows it (no colors). */
function TelegramPreview({ notice, style }: { notice: Notice; style: NoticeStyle }) {
  const m = styled(notice, style);
  return (
    <div className="rounded-lg bg-[#8eb6d3] p-3 dark:bg-[#0e1621]">
      <div className="max-w-md space-y-3 rounded-xl bg-white px-3 py-2 text-[13px] leading-snug text-black shadow-sm dark:bg-[#182533] dark:text-white">
        {style.format === 'plain' ? (
          <p className="whitespace-pre-wrap break-words">{plainText(notice, style)}</p>
        ) : (
          <>
            {m.head && <p className="italic">{m.head}</p>}
            {m.cards.map((c, i) => (
              <div key={i} className="space-y-1">
                {c.title && <p className="font-semibold">{c.title}</p>}
                {c.sub && <p className="italic">{c.sub}</p>}
                {c.body && <p className="whitespace-pre-wrap break-words">{c.body}</p>}
                {c.quote && (
                  <p className="rounded-r border-l-[3px] border-[#3390ec] bg-[#3390ec]/10 py-0.5 pl-2 whitespace-pre-wrap break-words">
                    {c.quote}
                  </p>
                )}
                {(c.when || c.url) && (
                  <p>
                    {c.when && (
                      <code className="rounded bg-black/5 px-1 text-[12px] dark:bg-white/10">
                        {c.when}
                      </code>
                    )}
                    {c.when && c.url && ' · '}
                    {c.url && <span className="text-[#3390ec]">{m.urlText ?? 'link'}</span>}
                  </p>
                )}
              </div>
            ))}
            {m.link && <p className="text-[#3390ec]">{m.linkText ?? m.link}</p>}
          </>
        )}
      </div>
    </div>
  );
}
