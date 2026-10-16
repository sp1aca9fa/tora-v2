'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import {
  type AlertState,
  addDiscordAction,
  connectTelegramAction,
  removeChannelAction,
  saveAlertPrefsAction,
  setTelegramBotAction,
  testChannelAction,
} from './actions';

function AlertMessage({ state, ok }: { state: AlertState; ok?: string }) {
  const t = useTranslations('alerts');
  if (state.error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {t.has(`error.${state.error}`) ? t(`error.${state.error}`) : t('testFailed')}
      </p>
    );
  }
  return state.ok && ok ? (
    <p role="status" className="text-xs text-muted-foreground">
      {ok}
    </p>
  ) : null;
}

interface Channel {
  id: string;
  kind: 'telegram' | 'discord';
  label: string | null;
  lastSent: string | null;
  lastError: string | null;
}

/** A person's channels, each with a test and a remove button. */
export function ChannelList({ channels }: { channels: Channel[] }) {
  const t = useTranslations('alerts');
  if (channels.length === 0) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  return (
    <ul className="divide-y rounded-md border">
      {channels.map((c) => (
        <ChannelRow key={c.id} channel={c} />
      ))}
    </ul>
  );
}

function ChannelRow({ channel: c }: { channel: Channel }) {
  const t = useTranslations('alerts');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AlertState>({});
  const name = `${t(c.kind)}${c.label ? ` ${c.label}` : ''}`;
  return (
    <li className={cn('space-y-1.5 px-3 py-2.5 text-sm', pending && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{name}</p>
          <p className="text-xs text-muted-foreground">
            {c.lastSent ? t('lastSent', { date: c.lastSent }) : t('neverSent')}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => startTransition(async () => setState(await testChannelAction(c.id)))}
        >
          {t('test')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t('removeConfirm', { name }))) return;
            startTransition(() => removeChannelAction(c.id));
          }}
        >
          {t('remove')}
        </Button>
      </div>
      {c.lastError && (
        <p className="text-xs break-words text-destructive">
          {t('lastError', { error: c.lastError })}
        </p>
      )}
      <AlertMessage state={state} ok={t('testSent')} />
    </li>
  );
}

/** Opens the bot with the person's code, then finds their Start message. */
export function TelegramConnect({ bot, link }: { bot: string; link: string }) {
  const t = useTranslations('alerts');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AlertState>({});
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">{t('telegramSteps')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={link} target="_blank" rel="noopener noreferrer">
            {t('telegramOpen', { bot })}
          </a>
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => setState(await connectTelegramAction()))}
        >
          {t('telegramCheck')}
        </Button>
      </div>
      <AlertMessage state={state} />
    </div>
  );
}

export function DiscordForm() {
  const t = useTranslations('alerts');
  const [state, formAction, pending] = useActionState<AlertState, FormData>(addDiscordAction, {});
  return (
    <form action={formAction} className="space-y-2 text-sm">
      <p className="text-muted-foreground">{t('discordHelp')}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          name="url"
          type="url"
          required
          aria-label={t('discordUrl')}
          placeholder="https://discord.com/api/webhooks/..."
          className="min-w-0 flex-1 basis-64"
          autoComplete="off"
        />
        <Button type="submit" disabled={pending}>
          {t('add')}
        </Button>
      </div>
      <AlertMessage state={state} ok={t('testSent')} />
    </form>
  );
}

export function AlertPrefsForm({
  admin,
  prefs,
  languages,
}: {
  admin: boolean;
  prefs: { failures: boolean; imports: boolean; actions: boolean; language: string };
  languages: { code: string; name: string }[];
}) {
  const t = useTranslations('alerts');
  const [state, formAction, pending] = useActionState<AlertState, FormData>(
    saveAlertPrefsAction,
    {},
  );
  const kinds = (admin ? ['failures', 'imports', 'actions'] : ['imports', 'actions']) as (
    'failures' | 'imports' | 'actions'
  )[];
  return (
    <form action={formAction} className="space-y-4 text-sm">
      <fieldset className="space-y-1.5">
        {kinds.map((k) => (
          <label key={k} className="flex items-start gap-2">
            <input
              type="checkbox"
              name={k}
              defaultChecked={prefs[k]}
              className="mt-0.5 size-4 shrink-0"
            />
            {t(k)}
          </label>
        ))}
        {/* Members never get failures; keep the saved value. */}
        {!admin && prefs.failures && <input type="hidden" name="failures" value="on" />}
      </fieldset>
      {languages.length > 1 && (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{t('language')}</span>
          <NativeSelect name="language" defaultValue={prefs.language} className="w-40">
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
        <AlertMessage state={state} ok={t('saved')} />
      </div>
    </form>
  );
}

/** The app's Telegram bot (admins). */
export function BotForm({ bot }: { bot: string | null }) {
  const t = useTranslations('alerts');
  const [state, formAction, pending] = useActionState<AlertState, FormData>(
    setTelegramBotAction,
    {},
  );
  return (
    <div className="space-y-3 text-sm">
      {bot && <p>{t('botSet', { bot })}</p>}
      <form action={formAction} className="flex flex-wrap gap-2">
        <Input
          name="token"
          type="password"
          required
          aria-label={t('botToken')}
          placeholder={t('botToken')}
          className="min-w-0 flex-1 basis-64"
          autoComplete="off"
        />
        <Button type="submit" disabled={pending}>
          {t('botSave')}
        </Button>
      </form>
      {bot && (
        <form
          action={formAction}
          onSubmit={(e) => {
            if (!window.confirm(t('botRemoveConfirm'))) e.preventDefault();
          }}
        >
          <input type="hidden" name="remove" value="1" />
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            {t('botRemove')}
          </Button>
        </form>
      )}
      <AlertMessage state={state} ok={t('saved')} />
    </div>
  );
}
