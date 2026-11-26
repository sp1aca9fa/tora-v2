# Alerts and the activity log

Tora sends messages to Telegram or Discord when something needs you, and keeps a log of what
happened (Settings > Activity).

## What is sent, and when

Who gets which message, what triggers it and when it repeats:
[the alert rules](rules/alerts.md#what-is-sent). In short: admins hear about failed or missing
runs, sources gone quiet, odd data and server updates; each person gets a morning summary (imports,
Actions, sharp drops), an alert when a watched item turns Good price or reaches its target, an alert when a sign-in to their account fails, and the store notices they chose.

### Tora's self check

Each morning, once, Tora checks its own data and tells admins when something looks odd, with what,
how much and the usual level. It fixes nothing: the message is the cue to look into it. Settings >
Collectors shows one row per source with sold prices (watching, learning, not seen since a date,
or too few sales to judge) and what is open. What it checks, its limits and when a finding closes:
[the self check's rules](rules/alerts.md#the-self-check).

After a real lasting change has been looked at, `pnpm alerts data-check-reset <source>` accepts the
numbers as they are.

### Store notices: how you are told

Each person picks one on **Stores > Area**. The default is every post, so nothing changes until you
choose otherwise:

- **Every post:** new posts (one per store per 30 minutes) and every reply, with their pictures and the post as written; a post that reached Tora over 30 minutes after it was posted makes none.
- **Sales starting:** a short message when someone in your area says a sale has started, in a post
  or a reply, or when 3 or more different people post about one store within 15 minutes, whatever
  the words (the safety net for wording Tora does not know and for people replying instead of
  posting). A burst's message says the store is busy, not that a sale started; an area holding many
  stores makes no burst, only words. The same person twice counts once; posts with no author count
  as one person. A message holds the time, the store, the products, the line holding the start word
  (a burst: the newest post's first line) and, for a burst, how many people; its title opens the
  store's row on Now. One per store per 30 minutes, with one exception: a start word right after a
  burst's message still goes through once. After a message, a burst needs three people anew. A start
  word the feed brought in up to 2 hours late still sends, at its real time. A failed send goes
  again with the next post about that store. "Send a test notice" on Stores > Area sends an example.
- **Off:** no store messages. Other alerts stay, and so do the store feed's own messages (posts
  naming an unknown store, silence), which have their own switches on Stores > Feed.

A board that shows posts late (its feed's lag) widens the 30-minute and 2-hour age limits above by that lag; the 30 minutes between messages about one store and a burst's 15 minutes stay: [Store notices](store-feeds.md#feeds-pushing-posts).

The words come from a store list plug-in and from admins (Stores > Codes): a **sale start word**
("started"), and a phrase that **is not a start** ("not started yet"), which rules out the post's
words. A plug-in's new words count after the next collect saves them; until then only bursts fire.
Admins can turn any of them off. These words are never shown as a post's code.

**Lotteries.** A confirmed lottery is a first post with a lottery word, an **application word**
("apply", "deadline"), no "not a lottery" phrase ("raffle queue") and no sale start; its replies go
with it. Its thread never sends
a Sales starting message and never counts toward a burst. A person can also move these threads off
the Now page ("Hide lottery posts on Now", on Now or Stores > Area); Now then says how many moved, with a link to
Lotteries. Anything unsure stays on Now. By store, By location, All posts and Lotteries keep showing
every post.

**Try a choice on past posts** (reads only, sends nothing, writes nothing to the database):

```bash
pnpm --silent --filter @tora/db stores-replay --user <name> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --out <file>
# or --busiest 7: the 7 days with the most posts about that person's area
# --words <file.json>: a JSON list of glossary entries to try besides the saved ones
# --lag <minutes>: the board shows posts this many minutes late
```

It writes the messages per day for each choice, each Sales starting message and why, what would not
be sent (per store, threads with replies or products first), and the threads that would leave Now.
It replays the same rules from when each post reached Tora: a post that arrived over 30 minutes
late makes no message unless it is a start word under 2 hours old (both plus the board's lag), as in real use.

A site refusing Tora counts as a failed collect, also when it refuses while reading rankings, box
opening cards, exchange rates, purchase links or pictures; a picture host no listing uses, or several sites share, records none ([Refusals](rules/collectors.md#refusals)). A listing set aside (found gone on 3 nights) is tried again every 7 days ([Collecting](rules/collectors.md#what-is-read)) by its source's normal collect: a
success brings it back and its Actions card goes away, a failure waits for the next try and sends
nothing. Known limit: it is not tried while its item has another active listing of that source, so
an item with two good listings there, one of them set aside, keeps that one aside until someone
links it again.

Each person picks their channels, switches each kind on or off and chooses the language of the
messages in **Settings > Alerts**. A failure at night arrives at night; Telegram and Discord can
mute a chat.

The morning check runs once a day: on a self-hosted server inside the app itself, from 08:00 app time (every 2 minutes it checks whether today's ran); on a hosted app when its cron job calls `/api/cron/daily`, at a fixed UTC hour (08:00 in Japan unless changed, see Setting up below). The times: [the alert rules](rules/alerts.md#words). A dev server (`pnpm dev`) runs it only with
`TORA_DEV_ALERTS=1`: it often runs on a copy of the real database, with its real channels.

### How messages look (Settings > Alerts > Message style)

Every message is a small heading, cards and a link: on Discord each card is an embed with a
colored edge, on Telegram the same in bold, italics and quotes (no colors). Each person can see
every kind (store posts and comments, unknown stores, store feed, buy timing, daily summary,
admin alerts, test) with example data as both apps show it, and change, per kind: cards or plain
text, the Discord colors, which parts show (heading, date and time, products, the post as written,
links), and the wording (each text with its {placeholders}, in their message language). The
previews follow every change; "Send this example" sends it to their own channels.

Buy alerts follow each person's buy strategy (see [Buy timing](buy-timing.md)); when one is sent
and when it repeats: [watch alerts](rules/alerts.md#watch-alerts).

### What was sent (Settings > Alerts > History)

Every message Tora sent you, newest first: its kind, the channel (Telegram or Discord, and its
name), the text as it went out, and whether it arrived (with the error when it did not). Filter by
kind, channel, outcome and dates. Kept 180 days on a self-hosted server; a hosted app keeps them all ([the alert rules](rules/alerts.md#what-was-sent)). A removed channel's messages stay.

## Setting up (admin, once)

1. **The morning check.** On your own server, nothing to do: the app runs it itself from 08:00
   (app time). On Vercel, add `CRON_SECRET` (any random value, e.g. `openssl rand -base64 32`) to
   the Vercel project's environment variables and redeploy. Vercel then calls `/api/cron/daily`
   once a day with it; without it the call is refused. The time is in `apps/web/vercel.json`
   (`"0 23 * * *"`: 23:00 UTC, 08:00 in Japan); change it for another time zone (the hour is UTC, so where clocks change for summer the check moves by an hour between seasons) and keep
   `MORNING_CHECK_UTC_HOUR` in `apps/web/src/lib/alerts.ts` the same, which Settings > Alerts
   shows. Vercel's free plan runs it once a day, within that hour. The store feed's silence check is not in that cron: on Vercel an outside scheduler must call `/api/feed/check` with the same secret every few minutes ([Store notices](store-feeds.md#no-silent-failures)); without it no silence message is sent.
2. **Telegram (optional).** In Telegram, talk to [@BotFather](https://t.me/BotFather), send
   `/newbot`, pick a name, and paste the token it gives into Settings > Alerts > Telegram bot. One
   bot serves every account. It is stored encrypted with `AUTH_SECRET`.
3. **The home PC.** Nothing to add: `scripts/collect-cron.sh` runs `pnpm alerts after-run` after
   the collect and the backup. It needs `AUTH_SECRET` in `.env` (the same as the app's, as for
   `pnpm user`).

## Adding a channel (each person)

- **Telegram:** Settings > Alerts > Connect Telegram (once an admin has added the bot, step 2 above) opens the bot with your own code; press Start in Telegram, come back and press Check. Do not share the link: it works until the end of the next day, and whoever presses Start with it can be added as one of your channels at your next Check. After Check, make sure the chat name Tora shows is yours. Tora reads the code back from the bot (messages
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
- the morning check's "nothing ran" and quiet sources, and what the self check found;
- a self-hosted server's updates and what its own scripts report (`pnpm alerts update`, `server`);
- admin changes: markets, sources and roles, identity pages, categories, languages, time zone,
  currency and rates, the night window, the Telegram bot, accounts (Settings > Admin > Accounts, or `pnpm user`:
  shown as done from the terminal), setup links used, and collects requested.

Admins see everything; others see their own imports.

## Commands

```bash
pnpm alerts after-run --since <time> [--collect-exit <n>] [--backup-exit <n>] [--log <file>]  # what collect-cron.sh runs
pnpm alerts market-refusals   # what market-jobs-cron.sh runs: a marketplace's refusal or stop, to admins
pnpm alerts check   # the morning check, run from the PC: real messages (admins: nothing ran; each person's summary when there is one, which the app's own check then skips for 20 hours)
pnpm alerts update --from <rev> --to <rev> [--failed <step> | --waiting pending|unknown] [--retry]   # a server's update script: logs it, a failure or a long wait to admins
pnpm alerts server <title> [--text <details>] [--level ok|problem|failed] [--tell]   # a server script's own event; --tell also sends it to admins
pnpm alerts data-check-reset <source>   # the self check accepts a source's numbers as they are
```
