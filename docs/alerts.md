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
| Odd data, from Tora's self check (below), or the check itself failing     | Admins      | The morning check (each finding once while it lasts)                         | The app's morning check         |
| A server's update that failed and was rolled back                         | Admins      | At once                                                                      | The server's update script      |
| Imports that did not add every row (already in Tora, left out, a problem) | Each person | The morning summary (at most one a day, only when there is something to say) | The app's morning check         |
| How many things wait on Actions                                           | Each person | The morning summary                                                          | The app's morning check         |
| A watched item turned Good price, or its lowest ask went under the target | Each person | Right after the nightly collect (again only after 14 days out)               | The home PC (`collect-cron.sh`) |
| Sharp drops: owned or watched items down 15 % or more in a week           | Each person | The morning summary (each item at most once in 14 days)                      | The app's morning check         |
| Store posts and comments for your area (your choice below), a feed silent | Each person | At once ([Store notices](store-feeds.md))                                    | The app                         |

### Tora's self check

Each morning, once, Tora checks its own data and tells admins when something looks odd, with what,
how much and the usual level. It fixes nothing: the message is the cue to look into it. It says
nothing until it has about 14 nights of its own numbers. Settings > Collectors shows one row per
source with sold prices (watching, learning, not seen since a date, or too few sales to judge) and
what is open.

- Within a source, on its sales of the last 7 days: the share far from the item's median (over 2x or
  under half) at 1.5x its usual share, or 5 % whatever is usual; sales kept under 0.7x the level a
  week ago; the part of found sales it keeps under 0.7x usual; sales it can judge under half of usual
  (while kept sales are low too, only when they fell clearly harder than those: one fault, one line).
- Across sources of one market, on 30 days: an item and condition with medians over 2x apart with 5+
  sales each, told in one group at most once a week; a source reading high or low on 10 more items one
  way than the other. Markets are never compared with each other.

A finding is told once while it lasts and closes after 3 nights judged and fine; a night not judged
(the server off, too few sales) does not count. A re-check of stored sales restarts only the far
share's level. Sources kept from AI models are left out where it reads. Sales with a guessed lot size
are left out of prices, and so is a sale with no condition.

It does not catch slabs filed as raw cards: only a sudden leak of them through the far share.

After a real lasting change has been looked at, `pnpm alerts data-check-reset <source>` accepts the
numbers as they are: that source's levels start over and its findings close. A new or reset source
says nothing for its own 14 nights, so one still at 5 % or more is told again, once, after them.
`apart`, and a lean of a source that has already learned, can speak from a new source's first night:
in a market of two, a new source's prices can make the older one read high or low.

### Store notices: how you are told

Each person picks one on **Stores > Area**. The default is every post, so nothing changes until you
choose otherwise:

- **Every post:** new posts (one per store per 30 minutes) and every reply, with their pictures and
  the post as written.
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
pnpm --silent --filter @tora/db stores-replay --user <name> --from <day> --to <day> --out <file>
# or --busiest 7: the 7 days with the most posts about that person's area
# --words <file.json>: a JSON list of glossary entries to try besides the saved ones
```

It writes the messages per day for each choice, each Sales starting message and why, what would not
be sent (per store, threads with replies or products first), and the threads that would leave Now.
It replays the same rules from when each post reached Tora: a post that arrived over 30 minutes
late makes no message unless it is a start word under 2 hours old, as in real use.

A site refusing Tora counts as a failed collect, also when it refuses while reading rankings or box
opening cards. A listing set aside is tried again every 7 days by its source's normal collect: a
success brings it back and its Actions card goes away, a failure waits for the next try and sends
nothing. Known limit: it is not tried while its item has another active listing of that source, so
an item with two good listings there, one of them set aside, keeps that one aside until someone
links it again.

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
- the morning check's "nothing ran" and quiet sources, and what the self check found;
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
pnpm alerts data-check-reset <source>   # the self check accepts a source's numbers as they are
```
