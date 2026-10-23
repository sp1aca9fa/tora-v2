import { alertPrefs } from '@tora/core';
import { MORNING_CHECK_HOUR, channelsOf, telegramBotName, telegramLink } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { nativeName } from '@/i18n/locale';
import { MORNING_CHECK_UTC_HOUR, alertContext } from '@/lib/alerts';
import { authed } from '@/lib/auth/guard';
import { getLanguages } from '@/lib/languages';
import { AlertPrefsForm, BotForm, ChannelList, DiscordForm, TelegramConnect } from './alerts-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.alerts.title') };
}

/** Alerts outside the app (S17): where they go, what is sent, the app's Telegram bot. */
export default async function AlertSettingsPage() {
  const { db, user } = await authed();
  const ctx = alertContext();
  const [channels, bot, link, languages, t, format] = await Promise.all([
    channelsOf(db, user.id),
    telegramBotName(db),
    ctx ? telegramLink(db, user.id, ctx.secret) : null,
    getLanguages(),
    getTranslations('alerts'),
    getFormatter(),
  ]);
  const prefs = alertPrefs(user.preferences);
  const admin = user.role === 'admin';
  // On a hosting platform its cron job runs the morning check (UTC); a server runs it itself.
  const hosted = !!process.env.VERCEL;
  const check = new Date();
  check.setUTCHours(MORNING_CHECK_UTC_HOUR, 0, 0, 0);
  const morning = hosted
    ? t('scheduleHosted', { time: format.dateTime(check, { timeStyle: 'short' }) })
    : t('schedule', { time: `${String(MORNING_CHECK_HOUR).padStart(2, '0')}:00` });
  const langs = [languages.primary, languages.secondary].filter((l): l is string => !!l);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('info')}</CardDescription>
          <p className="pt-1 text-sm">
            <Link href="/settings/alerts/style" className="font-medium underline">
              {t('styleLink')}
            </Link>{' '}
            <span className="text-muted-foreground">{t('styleInfo')}</span>
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('channels')}</h3>
            <ChannelList
              channels={channels.map((c) => ({
                ...c,
                lastSent: c.lastSentAt
                  ? format.dateTime(new Date(c.lastSentAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : null,
              }))}
            />
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('addTelegram')}</h3>
            {bot && link ? (
              <TelegramConnect bot={bot} link={link} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('telegramNoBot')}</p>
            )}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('addDiscord')}</h3>
            <DiscordForm />
          </section>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('what')}</CardTitle>
          <CardDescription>{morning}</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertPrefsForm
            admin={admin}
            prefs={{ ...prefs, language: prefs.language ?? languages.primary }}
            languages={langs.map((code) => ({ code, name: nativeName(code) }))}
          />
        </CardContent>
      </Card>
      {admin && (
        <Card>
          <CardHeader>
            <CardTitle>{t('bot')}</CardTitle>
            <CardDescription>{t('botInfo')}</CardDescription>
          </CardHeader>
          <CardContent>
            <BotForm bot={bot} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
