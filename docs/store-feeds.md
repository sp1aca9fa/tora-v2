# Store notices: feeds and store lists

Tora can tell you when people post that cards are on sale in a physical store near you
(requirements S25). Two kinds of plug-in feed it, and Tora does the rest: it recognizes the store
in each post, keeps the stores of your area (stores you pick, or a distance from where you are,
with a travel mode) and sends a notice to your Discord or Telegram (Settings > Alerts).

Tora ships neither the store lists nor the readers of any site: like collectors, they are yours
to write (see [Building a collector](collectors.md) for where plug-ins live).

## Store lists (`StoreDirectory`)

A plug-in package exports its store lists next to its collectors:

```ts
export const stores: StoreDirectory[] = [
  {
    key: 'my-stores',
    label: 'My stores',
    language: 'ja', // the language the names below are written in
    stores: () => [
      {
        key: 'megastore-chuo', // stable within the list
        chain: 'megastore', // posts from a chain's board are matched to its stores only
        chainLabel: 'メガストア',
        name: 'メガストア中央',
        codes: ['中央', 'MID'], // what posters write for it
        region: '大阪府',
        lat: 34.5, // made up
        lon: 135.5,
      },
    ],
  },
];
```

A list says the language its stores' names are written in (`language: 'ja'`), and a store can
carry short labels in other languages (`labels: { en: 'Megastore Ekimae' }`; a place:
`{ en: 'Ekimae' }`), used in notices and on the Stores page for people reading that language;
someone reading a language with no label of its own gets the English one, and without any, the
chain and name as written. The full shape is the `StoreDirectory` type in `@tora/collector-sdk` (`stores()` may be async).

A list can also carry a `glossary`: codes posters use that are no store or place (a state such as
"none", a product, a chain), each with its meaning; `product: true` marks a product, `chain:
true` a chain's name or mark (its meaning the chain's name): a post naming a chain and only areas
reads as that chain's branch there ("Arcade · Harbor"), with no store at all as a branch not
named. The
Stores page shows every code with what it stands for, and admins can add other codes there,
products ticked as such, and turn off a list's or feed's code (a board's own list can be out of
date) or turn it back on.

Product codes are named in notices next to the store ("メガストア 港町 · スノーセット"),
then the post as written. An admin's codes and emoji codes count anywhere in a post (Latin ones as
whole words), as do codes of three characters or more; a feed's shorter ones ("X", "b") only in a
run of the post (between spaces and punctuation) made entirely of codes, numbers and common words,
so a one-letter code inside an ordinary word is not taken for a product.

The lists are saved each time the home PC runs a collect or an import (only what changed is
written). Coordinates are needed for "distance from where I am"; without them a store can still
be picked by hand. Admins can add codes the list does not know on the Stores page.

How a post is matched: within the post's chain, a store whose name or one of its codes appears in
the text (a chain's codes count on its own board only); when none matches, or the board mixes
chains, a place (chain `place`: an area's name or code with its location) the text names. Case and full-width letters do not matter. Codes in Latin letters must stand as whole words, not touching another Latin letter or digit ("KTA" does not match "KTAX", nor "MID" "MID30th"; "MID" matches "中央MID"); other codes match anywhere. When one code contains another that also
matched ("新宿西口", "新宿"), the longer one wins.

## Feeds: pushing posts

Anything that can send an HTTP request can be a feed: a userscript in your own browser on the
page people post on, a bot in a chat you are in, a small script. Make a feed token on the Stores
page (shown once; making a new one stops the old one), then:

```http
POST /api/feed/posts
Authorization: Bearer tora_feed_...
Content-Type: application/json

{
  "source": "myboard",
  "chain": "megastore",
  "posts": [
    {
      "id": "12345",
      "text": "MID 30th 店頭販売開始",
      "author": "中央の人",
      "url": "https://example.com/board#12345",
      "postedAt": "2026-10-19T12:34:00+09:00"
    }
  ]
}
```

Required: `source`, `posts`, and each post's `id` and `text`; every other field is optional.

- `source`: a short key for the board's site (a-z, 0-9, `-`, `_`, up to 40 characters; another refuses the push), shared by every person's feed: a post is its `source` and `id`, whoever sends it first (its chain, stores and pictures are that push's); "a feed's very first push" below is the first under that key from anyone; `products` replaces that key's list for everyone.
- `board`: the board (page) read, when the feed reads several, a key written like `source` (another is dropped, and the push then counts under its `chain`, else its `source`): each board's last visit and last posts are shown on the Stores page, and a board giving no posts for longer than its person's silence alert times the boards watched times 2 ([No silent failures](#no-silent-failures)) while the feed runs is told (an access check or a changed page would otherwise go unnoticed).
- `offered`: every board the feed can read (a list of board keys written like `source`, up to 20); the person can then choose in the app which ones it
  watches, and the answer to each push carries that choice as `watch` (a list of board keys, or null when the feed decides).
- `seen` and `gap` (optional, to send less): a feed may send only the posts it did not send
  before; it then says how many posts the page showed (`seen`, a number, so a board showing none for too long is told) and whether the page turned over since its last visit (`gap`, true or false). Without them Tora
  works it out from the posts sent, which costs a few more rows read per push.
- `hello`: true once when the feed (re)starts (a new tab or browser session, a new version): its
  person is told "connected" again, so a restart is confirmed.
- `next` (optional): where and when the feed reads next, `{ "board": "store-b", "at": "<ISO time>" }` (a time with its offset, within the next 9 hours; a later one is ignored); until then the feed is not silent ([No silent failures](#no-silent-failures));
  the Stores pages show it counting down, then "reading" while it is due, and late when no push
  comes within a minute and a half. A push without it clears it.
- `watching`: every board the feed goes through (board keys, up to 20); its person is told "connected, tracking these
  boards" on the first push, after a silence, and when the list changes.
- `chain`: the board's chain when the whole push is about one chain; a post can carry its own.
- `lagMinutes` (optional): the board shows posts this many minutes after their posted time (a
  board that shows members posts at once and guests 30 minutes later: `30`). Minutes, rounded; above 180 counts as 180, and anything that is not a positive number as 0. A post counts as new for notices for 30 minutes plus the lag (the
  sales starting choice: its 2-hour window for a late start word, and bursts, grow by it too);
  notices still show the post's own time, and the quiet time between notices does not change.
- `products` (optional): the board's own list of product codes (`[{ "code": "X1", "meaning":
"スノーセット" }]`), saved when it changes (an empty list changes nothing); send it when it changes (and with `hello`).
- `replyTo` (per post): the id of the post it answers, for replies (comments) such as "still a
  line" or "sold out"; a reply is a post of its own in `posts`, and the post it answers may come in the same push or an earlier one under the same `source`. A reply naming no store takes the stores of the post it answers; replies
  are sent to the people whose area holds the store at once, under their post (or, the post not
  in the notice, with its start), even within the store's quiet time (a new post about a store
  makes at most one notice every 30 minutes; a person can choose only sales starting, see
  [Alerts](alerts.md)). On the Stores pages a post shows every reply in its
  thread under it, answers to replies included, oldest first.
- `official` (per post, optional): `true` when the board's own staff (its admins) wrote it, as the
  board marks it. A new first post marked so goes to everyone with store notices on and an area,
  whatever stores it names or none, as a card "From the board's staff" (in its own message under
  the sales starting choice); once per post, its pictures attached. One the area's rules already
  tell is not repeated; staff replies follow the usual rules; a staff post naming no store is not
  sent as an unknown store. The mark is taken as the feed sends it, and any account can make a feed token: on an install with other accounts, a staff mark from any of them reaches everyone with an area.
- `images` (per post, optional): its pictures, `[{ "url": "<where it was found>", "data": "<base64>" }]`,
  up to 4, 8 MB each once decoded (JPEG, PNG, WebP or GIF; a 5th and later, and any too big or not a picture, are left out, the post kept). Kept a week, attached to the post's notices and
  shown on the Posts page. Send a post's pictures with its first push only (a post sent again is
  ignored, pictures too), and shrink them first: every backup holds the week's pictures.
- `id`: the post's id on its site (or any stable key): a post sent again (the same `source` and `id`) is ignored, even edited, so sending the whole visible page every time is fine and a push is safe to send again. At most 200 posts a push (more refuses the whole push).
- `author`: the poster's name, when the site shows one; stores are looked for in it too (some posters name their store in it).
- Longer values are cut: `text` at 2,000 characters, `author` at 100; a `url` not starting with `http://` or `https://` is dropped.
- `postedAt`: when the site shows it, an ISO time with its offset (`+09:00` or `Z`; one without an offset is read in the server's own time zone, which may not be the board's); left out or null, the time Tora received it. Notices count a post's age from it. A time that cannot be read refuses the whole push.
- An empty `posts` list is a heartbeat: the Stores page shows when the feed was last heard from,
  so you know it is still running.

The answer to a later push (a first push sends no notices):

```json
{
  "received": 1,
  "new": 1,
  "matched": 1,
  "notices": 1,
  "gap": false,
  "watch": null,
  "tracking": { "on": true, "until": null, "resumeAt": null }
}
```

`received`: posts in the push; `new`: those not seen before; `matched`: new ones naming a store; `notices`: messages sent (one per person told; two when a staff card goes on its own); `gap`: whether the person was told posts may have been missed. A wrong or replaced token gets 401 `{ "error": "unauthorized" }`; a body that breaks a rule above (not JSON, a bad `source`, more than 200 posts, a post without `id` or `text`, a `postedAt` that is not a time) gets 400 with `error` saying what, and nothing of it is saved.

Notices: only for posts of the last 30 minutes (plus the push's `lagMinutes`; the sales starting choice takes a start word up to 2 hours late, [Alerts](alerts.md#store-notices-how-you-are-told)), at most one per store every 30 minutes for each person (a post naming several stores goes once one of them is out of its quiet time, and names them all), and none for a feed's very first push (it usually brings a page of old posts).

### Working hours

An admin can have feeds read only within working hours (**Settings > Admin preferences > Board
tracker**; off by default: around the clock), as a person would, not all night. Each day the
tracker starts a random delay after the start and stops one before the end (a range the admin
sets, e.g. 60 to 300 seconds), so it never starts or stops on the minute.

The answer to every push carries `tracking`, and a feed can ask for it alone with its token:

```http
GET /api/feed/tracking
Authorization: Bearer tora_feed_...
```

```json
{ "tracking": { "on": false, "until": null, "resumeAt": "2026-10-27T09:03:12.000+09:00" } }
```

While `on`, read until `until` (null: no end). When it is false, read nothing, send nothing and
reload nothing: stay on the page and ask again every minute or so (this asks Tora only, never the
site), then open the board again once `on` comes back. The Stores pages show a red bar while the
tracker is stopped, and admins can track from there for an hour, or until the next start (once:
the hours go on as usual after). Silence alerts rest outside the hours and count from the tracker's start (after its random delay).

### A browser feed (userscript) skeleton

For a page that only a real browser can read (a bot check, a login), a userscript (Tampermonkey,
Violentmonkey) in your own browser can be the feed while the page is open. The reading of the page
is yours to write; the rest looks like this:

```js
// ==UserScript==
// @name     My board feed for Tora
// @match    https://example.com/board/*
// @grant    GM_xmlhttpRequest
// @grant    GM_getValue
// @grant    GM_setValue
// @connect  *
// ==/UserScript==

const TORA = GM_getValue('url', 'http://localhost:3000'); // set both once: GM_setValue('url', ...), GM_setValue('token', ...)
const TOKEN = GM_getValue('token', '');

/** Yours: the posts on the page, newest first. */
function readPosts() {
  return [...document.querySelectorAll('.post')].map((el) => ({
    id: el.dataset.id,
    text: el.querySelector('.text').innerText,
    author: el.querySelector('.author')?.innerText ?? null,
    postedAt: null, // an ISO time with its offset, when the page shows one
    url: location.href,
  }));
}

GM_xmlhttpRequest({
  method: 'POST',
  url: `${TORA}/api/feed/posts`,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  data: JSON.stringify({
    source: 'myboard',
    board: 'main',
    watching: ['main'],
    posts: readPosts(),
  }),
});
// Read again in a while (a page every 3 to 5 minutes). Run it in one tab only: each tab reads at
// this pace. A real feed also waits longer after a refused page or one with no posts ("Reading
// sites politely" below), which this skeleton does not, and asks for the working hours first (above).
setTimeout(() => location.reload(), (180 + Math.random() * 120) * 1000);
```

Even when the page shows no post, push (an empty list is the heartbeat), so a page that stops
giving posts is noticed. With working hours set, ask `/api/feed/tracking` before reading the page
and skip the reload while `on` is false (above).

## How notices look

Store notices follow the Now page: a card per location (an area and the stores near it), the
newest first, its name linking to that row on Now (opened); in it a section per store, each post
with its time, the products its codes stand for, a link to the post and the post as written, its
replies under it. On Discord the times show in the reader's time zone with how long ago, kept up
to date by Discord. On Telegram each location is a message of its own, long posts are folded (a tap
opens them), and a reply to a post told earlier answers that post's message (remembered 3 days).
In a Discord forum channel each location has a post of its own each day, its later messages
added to it ([Alerts](alerts.md#adding-a-channel-each-person)).
The look and wording are set per person in Settings > Alerts > Message style.

## No silent failures

Besides the notices for your area, the person whose feed sent the posts is told:

- when the feed has sent nothing for as long as they chose (15, 30 or 60 minutes; 15 unless changed; a limit saved before as 5 or 10 counts as 15) within their hours (08:00-23:00 unless changed; the end not included): told then, again every 2 hours while it lasts, and when it sends again; a board giving no posts for that limit times the number of boards watched times 2 is told the same way (they are read in turn, the next one at random, and a newest page's page before takes a turn too: 120 minutes for 4 boards at 15). The boards watched are the larger of those the last push named in `watching` and those visited in the last 6 hours (with one tab per board, each push names only its own). A silence alert says when the next visit the last push announced was due, when it announced one; the Feed tab shows "waiting until" that time while a wait longer than the limit is announced. The wait a push announces in `next` is no silence: silence counts from the later of the last push and that next visit, so a step or a refused site's retry time is not told, and a next visit past by more than the limit is told as usual; a board visited without posts stays silent (only that wait is not counted). The Stores pages' status (the pill, the Feed tab) shows silent and quiet the same way. The app checks every 2 minutes ([the alerts rules](rules/alerts.md#numbers)) while it runs
  as a server on your own PC (`pnpm app`); a hosted app has nothing running between requests, so
  an outside scheduler (cron-job.org, a GitHub Actions schedule) calls
  `GET /api/feed/check` with `Authorization: Bearer $CRON_SECRET` (the app's secret, not a feed token) every few minutes (a GitHub Actions schedule runs at most every 5 minutes and can be late or skipped under load, so its alerts can come late);
- about recent posts naming no store or place Tora knows (add the code on the Stores page; posts
  that are no sighting, questions or chat, come too); this can be switched off;
- when a push of 10 or more posts is all new (one pinned post aside) and its `source` already had posts of the push's `chain` (from any board): the page turned over completely between two visits, so posts may have been missed; a feed that sends `gap` decides this itself.

The settings are on the Stores page, next to the feed's state.

## Reading sites politely

Read only what the site lets visitors read, and ask little of it: a page every 3 to 5 minutes for
the whole feed (not per board or per tab), only what changed opened (a thread whose reply count went
up), and working hours set. A page every 40 seconds with many reply loads got one browser refused;
no pace is known to be safe. Choose a silence alert well above the time between two pages (15 minutes, the shortest choice, at this pace); each board's limit grows with the number of boards by itself.

A page that checks for bots is not to be worked around: read it from your own browser while you
have it open, as a userscript does, or not at all.

When the site refuses (a 403 or 429, a bot-check page, or a page with no posts but a pinned one), do not keep reloading it: wait longer after each such page (for example 15, 30, then 60 minutes), then try only every few hours (for example once at random every 2 to 8 hours), every board of that site together,
until it shows its posts again. Count what the feed asks for per day, so a refusal can be compared
with the pace before it. A block is not to be got around (another address, a VPN).
