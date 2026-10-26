# Alerts and the activity log

Tora sends messages to Telegram or Discord when something needs you, and keeps a log of what
happened (Settings > Activity).

## What is sent, and when

| Message                                                                   | To          | When                                                                         | Sent by                         |
| ------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------- |
| The collect or the backup failed                                          | Admins      | Right after the run (at most once a day per kind)                            | The home PC (`collect-cron.sh`) |
| No collect or no backup for over 26 hours (the PC is off)                 | Admins      | The morning check                                                            | The app's morning check         |
| Listings set aside (gone 3 nights), a quiet source, a self-check fix      | Admins      | Right after the run, or the morning check (a quiet source: once a day)       | Both                            |
| The database's month heading past its read budget (hosted database)       | Admins      | The morning check                                                            | The app's morning check         |
| A server's update that failed and was rolled back                         | Admins      | At once                                                                      | The server's update script      |
| Imports that did not add every row (already in Tora, left out, a problem) | Each person | The morning summary (at most one a day, only when there is something to say) | The app's morning check         |
| How many things wait on Actions                                           | Each person | The morning summary                                                          | The app's morning check         |
| A watched item turned Good price, or its lowest ask went under the target | Each person | Right after the nightly collect (again only after 14 days out)               | The home PC (`collect-cron.sh`) |
| Sharp drops: owned or watched items down 15 % or more in a week           | Each person | The morning summary (each item at most once in 14 days)                      | The app's morning check         |
| Store posts and comments for your area, a store feed gone silent          | Each person | At once ([Store notices](store-feeds.md))                                    | The app                         |

Each person picks their channels, switches each kind on or off and chooses the language of the
messages in **Settings > Alerts**. A failure at night arrives at night; Telegram and Discord can
mute a chat.

The morning check runs from 08:00 (app time): on a self-hosted server inside the app itself (every
2 minutes it checks whether today's ran), on a hosted app from its cron job (`/api/cron/daily`). A dev server (`pnpm dev`) runs it only with
`TORA_DEV_ALERTS=1`: it often runs on a copy of the real database, with its real channels.

### How messages look (Settings > Alerts > Message style)

Every message is a small heading, cards and a link: on Discord each card is an embed with a
colored edge, on Telegram the same in bold, italics and quotes (no colors). Each person can see
every kind (store posts and comments, unknown stores, store feed, buy timing, daily summary,
admin alerts, test) with example data as both apps show it, and change, per kind: cards or plain
text, the Discord colors, which parts show (heading, date and time, products, the post as written,
links), and the wording (each text with its {placeholders}, in their message language). The
previews follow every change; "Send this example" sends it to their own channels.

Buy alerts follow each person's buy strategy (see [Buy timing](buy-timing.md)) and use only that
night's numbers, so a failed collect sends none. A Good price with little data is sent unless the
watch's "Alert on Good price even with limited data" is off. Tora remembers each watch's state:
an item that slips out of its zone and back within 14 days does not alert twice; changing a
watch's condition or target starts over.

### What was sent (Settings > Alerts > History)

Every message Tora sent you, newest first: its kind, the channel (Telegram or Discord, and its
name), the text as it went out, and whether it arrived (with the error when it did not). Filter by
kind, channel, outcome and dates. Kept 180 days; a removed channel's messages stay.

## Setting up (admin, once)

1. **The morning check.** On your own server, nothing to do: the app runs it itself from 08:00
   (app time). On Vercel, add `CRON_SECRET` (any random value, e.g. `openssl rand -base64 32`) to
   the Vercel project's environment variables and redeploy. Vercel then calls `/api/cron/daily`
   once a day with it; without it the call is refused. The time is in `apps/web/vercel.json`
   (`"0 23 * * *"`: 23:00 UTC, 08:00 in Japan); change it for another time zone and keep
   `MORNING_CHECK_UTC_HOUR` in `apps/web/src/lib/alerts.ts` the same, which Settings > Alerts
   shows. Vercel's free plan runs it once a day, within that hour.
2. **Telegram (optional).** In Telegram, talk to [@BotFather](https://t.me/BotFather), send
   `/newbot`, pick a name, and paste the token it gives into Settings > Alerts > Telegram bot. One
   bot serves every account. It is stored encrypted with `AUTH_SECRET`.
3. **The home PC.** Nothing to add: `scripts/collect-cron.sh` runs `pnpm alerts after-run` after
   the collect and the backup. It needs `AUTH_SECRET` in `.env` (the same as the app's, as for
   `pnpm user`).

## Adding a channel (each person)

- **Telegram:** Settings > Alerts > Connect Telegram opens the bot with your own code; press
  Start in Telegram, come back and press Check. Tora reads the code back from the bot (messages
  stay there a day) and sends a first message.
- **Discord:** in a channel's settings > Integrations > Webhooks > New webhook > Copy webhook URL,
  then paste it in Settings > Alerts. Tora checks it and sends a test.
- **Discord forum channel:** a webhook made in a forum channel works the same (forum channels may
  need the server's Community setting). Tora sees it is a forum on the first message and keeps
  each location's store notices in a post of its own each day, other alerts in one "Tora" post.
  In a forum only a message that mentions you notifies: add your Discord user ID under the channel
  (Discord Settings > Advanced > Developer Mode, then right-click your name > Copy User ID). The
  ID can be set on any Discord channel; every message then mentions you.

"Send a test" checks a channel at any time; a channel whose last message failed shows why.
Webhook links and chat IDs are stored encrypted.

## The activity log

Settings > Activity lists, newest first, each linked to its page:

- collects (each run of `pnpm collect`, with the sources that did not finish) and backups;
- imports (what happened to their rows; members see their own);
- the morning check's "nothing ran" and quiet sources;
- a self-hosted server's updates and what its own scripts report (`pnpm alerts update`, `server`);
- admin changes: markets, sources and roles, identity pages, categories, languages, time zone,
  currency and rates, the night window, the Telegram bot, accounts (Settings > Admin > Accounts, or `pnpm user`:
  shown as done from the terminal), setup links used, and collects requested.

Admins see everything; others see their own imports.

## Commands

```bash
pnpm alerts after-run --since <time> --collect-exit <n> --backup-exit <n>  # what collect-cron.sh runs
pnpm alerts check   # the morning check, run from the PC (e.g. to try it)
pnpm alerts update --from <rev> --to <rev> [--failed <step>]   # a server's update script: logs it, a failure to admins
pnpm alerts server <title> [--text <details>] [--level ok|problem|failed] [--tell]   # a server script's own event
```
