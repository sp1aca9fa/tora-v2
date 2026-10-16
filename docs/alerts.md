# Alerts and the activity log

Tora sends messages to Telegram or Discord when something needs you, and keeps a log of what
happened (Settings > Activity).

## What is sent, and when

| Message                                                                   | To          | When                                                                         | Sent by                         |
| ------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------- |
| The collect or the backup failed                                          | Admins      | Right after the run (at most once a day per kind)                            | The home PC (`collect-cron.sh`) |
| No collect or no backup for over 26 hours (the PC is off)                 | Admins      | The morning check                                                            | The app (Vercel cron)           |
| Imports that did not add every row (already in Tora, left out, a problem) | Each person | The morning summary (at most one a day, only when there is something to say) | The app (Vercel cron)           |
| How many things wait on Actions                                           | Each person | The morning summary                                                          | The app (Vercel cron)           |

Each person picks their channels, switches each kind on or off and chooses the language of the
messages in **Settings > Alerts**. A failure at night arrives at night; Telegram and Discord can
mute a chat.

## Setting up (admin, once)

1. **The morning check.** Add `CRON_SECRET` (any random value, e.g. `openssl rand -base64 32`) to
   the Vercel project's environment variables and redeploy. Vercel then calls `/api/cron/daily`
   once a day with it; without it the call is refused. The time is in `apps/web/vercel.json`
   (`"0 23 * * *"`: 23:00 UTC, 08:00 in Japan); change it for another time zone and keep
   `MORNING_CHECK_UTC_HOUR` in `apps/web/src/lib/alerts.ts` the same, which Settings > Alerts
   shows. Vercel's free plan runs it once a day, within that hour.
2. **Telegram (optional).** In Telegram, talk to [@BotFather](https://t.me/BotFather), send
   `/newbot`, pick a name, and paste the token it gives into Settings > Alerts > Telegram bot. One
   bot serves every account. It is stored encrypted with `AUTH_SECRET`.
3. **The home PC.** Nothing to add: `scripts/collect-cron.sh` runs `pnpm alerts after-run` after
   the collect and the backup. It needs `AUTH_SECRET` in `.env` (the same as Vercel's, as for
   `pnpm user`).

## Adding a channel (each person)

- **Telegram:** Settings > Alerts > Connect Telegram opens the bot with your own code; press
  Start in Telegram, come back and press Check. Tora reads the code back from the bot (messages
  stay there a day) and sends a first message.
- **Discord:** in a channel's settings > Integrations > Webhooks > New webhook > Copy webhook URL,
  then paste it in Settings > Alerts. Tora checks it and sends a test.

"Send a test" checks a channel at any time; a channel whose last message failed shows why.
Webhook links and chat IDs are stored encrypted.

## The activity log

Settings > Activity lists, newest first, each linked to its page:

- collects (each run of `pnpm collect`, with the sources that did not finish) and backups;
- imports (what happened to their rows; members see their own);
- the morning check's "nothing ran";
- admin changes: markets, sources and roles, identity pages, categories, languages, time zone,
  currency and rates, the night window, the Telegram bot, and accounts changed with `pnpm user`
  (shown as done from the terminal).

Admins see everything; others see their own imports.

## Commands

```bash
pnpm alerts after-run --since <time> --collect-exit <n> --backup-exit <n>  # what collect-cron.sh runs
pnpm alerts check   # the morning check, run from the PC (e.g. to try it)
```
