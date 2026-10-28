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
    stores: () => [
      {
        key: 'megastore-chuo', // stable within the list
        chain: 'megastore', // posts from a chain's board are matched to its stores only
        chainLabel: 'メガストア',
        name: 'メガストア中央',
        codes: ['中央', 'MID'], // what posters write for it
        region: '大阪府',
        lat: 34.7041,
        lon: 135.4963,
      },
    ],
  },
];
```

A list says the language its stores' names are written in (`language: 'ja'`), and a store can
carry short labels in other languages (`labels: { en: 'Megastore Ekimae' }`; a place:
`{ en: 'Ekimae' }`), used in notices and on the Stores page for people reading that language;
someone reading a language with no label of its own gets the English one, and without any, the
chain and name as written.

A list can also carry a `glossary`: codes posters use that are no store or place (a state such as
"none", a chain's mark, a product), each with its meaning; `product: true` marks a product. The
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
chains, a place (chain `place`: an area's name or code with its location) the text names. Codes in Latin letters must stand as whole words ("KTA"
does not match "KTAX"); other codes match anywhere. When one code contains another that also
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

- `source`: a short key for the feed (a-z, 0-9, `-`, `_`).
- `board`: the board (page) read, when the feed reads several: each board's last visit and last
  posts are shown on the Stores page, and a board giving no posts for too long while the feed runs
  is told (an access check or a changed page would otherwise go unnoticed).
- `offered`: every board the feed can read; the person can then choose in the app which ones it
  watches, and the answer to each push carries that choice as `watch` (null when the feed decides).
- `seen` and `gap` (optional, to send less): a feed may send only the posts it did not send
  before; it then says how many posts the page showed (`seen`, so a board showing none for too
  long is told) and whether the page turned over since its last visit (`gap`). Without them Tora
  works it out from the posts sent, which costs a few more rows read per push.
- `hello`: true once when the feed (re)starts (a new tab or browser session, a new version): its
  person is told "connected" again, so a restart is confirmed.
- `next` (optional): where and when the feed reads next, `{ "board": "store-b", "at": "<ISO time>" }`;
  the Stores pages show it counting down, then "reading" while it is due, and late when no push
  comes within a minute and a half. A push without it clears it.
- `watching`: every board the feed goes through; its person is told "connected, tracking these
  boards" on the first push, after a silence, and when the list changes.
- `chain`: the board's chain when the whole push is about one chain; a post can carry its own.
- `products` (optional): the board's own list of product codes (`[{ "code": "X1", "meaning":
"スノーセット" }]`), saved when it changes; send it when it changes (and with `hello`).
- `replyTo` (per post): the id of the post it answers, for replies (comments) such as "still a
  line" or "sold out". A reply naming no store takes the stores of the post it answers; replies
  are sent to the people whose area holds the store at once, under their post (or, the post not
  in the notice, with its start), even within the store's quiet time (a new post about a store
  makes at most one notice every 30 minutes). On the Stores pages a post shows every reply in its
  thread under it, answers to replies included, oldest first.
- `images` (per post, optional): its pictures, `[{ "url": "<where it was found>", "data": "<base64>" }]`,
  up to 4, 8 MB each (JPEG, PNG, WebP or GIF). Kept a week, attached to the post's notices and
  shown on the Posts page. Send a post's pictures with its first push only (a post sent again is
  ignored, pictures too), and shrink them first: every backup holds the week's pictures.
- `id`: the post's id on its site (or any stable key): a post sent again is ignored, so sending
  the whole visible page every time is fine. At most 200 posts a push.
- `author`: the poster's name, when the site shows one; stores are looked for in it too (some
  posters name their store in it).
- `postedAt`: when the site shows it; otherwise the time Tora received it.
- An empty `posts` list is a heartbeat: the Stores page shows when the feed was last heard from,
  so you know it is still running.

The answer says how many posts were new, matched a store, and how many people were notified:

```json
{ "received": 1, "new": 1, "matched": 1, "notices": 1, "gap": false, "watch": null }
```

Notices: only for posts of the last 30 minutes, at most one per store every 30 minutes for each
person, and none for a feed's very first push (it usually brings a page of old posts).

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
the hours go on as usual after). Silence alerts rest outside the hours and count from the start.

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
// @connect  *
// ==/UserScript==

const TORA = GM_getValue('url', 'http://localhost:3000'); // set both once (GM_setValue)
const TOKEN = GM_getValue('token', '');

/** Yours: the posts on the page, newest first. */
function readPosts() {
  return [...document.querySelectorAll('.post')].map((el) => ({
    id: el.dataset.id,
    text: el.querySelector('.text').innerText,
    author: el.querySelector('.author')?.innerText ?? null,
    postedAt: null, // an ISO time when the page shows one
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
// Read again in a while, at a person's pace (a page every minute or two).
setTimeout(() => location.reload(), 90_000);
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
The look and wording are set per person in Settings > Alerts > Customize notices.

## No silent failures

Besides the notices for your area, the person whose feed sent the posts is told:

- when the feed has been silent longer than they chose (5 to 60 minutes) within their hours (e.g.
  08:00-23:00), once, and again when it sends again. The app checks every 2 minutes while it runs
  as a server on your own PC (`pnpm app`); a hosted app has nothing running between requests, so
  an outside scheduler (cron-job.org, a GitHub Actions schedule) calls
  `GET /api/feed/check` with `Authorization: Bearer $CRON_SECRET` every few minutes;
- about recent posts naming no store or place Tora knows (add the code on the Stores page; posts
  that are no sighting, questions or chat, come too); this can be switched off;
- when a push of 10 or more posts is all new (one pinned post aside) on a board seen before: the
  page turned over completely between two visits, so posts may have been missed.

The settings are on the Stores page, next to the feed's state.

## Reading sites politely

Read only what the site lets visitors read, at a person's pace (a reload every minute or two).
A page that checks for bots is not to be worked around: read it from your own browser while you
have it open, as a userscript does, or not at all.
