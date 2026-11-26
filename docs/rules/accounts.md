# Accounts and access

How a person signs in, what a device and a session are, what stops guessing, what an admin and a
member may see or change, how accounts are made and reset, and what is encrypted with what. This
file is the one home of these rules and their numbers. The code is `packages/auth/src`, `packages/db/src/users.ts`, `accounts.ts`, `account-data.ts` and `scripts/user.ts`, `apps/web/src/lib/auth`, `apps/web/src/proxy.ts`, `apps/web/src/app/login`, the admin's account tasks (`settings/admin/accounts/actions.ts`), the import route (`apps/web/src/app/import/account`) and `packages/mcp/src`. Setting up accounts: [Setup](../setup.md).

Not here: the message sent about a failed sign-in ([Alerts](alerts.md#what-is-sent)); what is one
person's and what is shared, table by table ([The data model](data-model.md)); backups of the
whole database ([Backups](../backups.md)).

## Signing in

1. **Name and password.** A name is turned to lower case, when made and at sign-in, and must then be 3 to 32 characters of a-z, 0-9, dot, underscore and hyphen. A password has 12 characters or more.
2. **A code**: the 6 digits of the authenticator, or a backup code. The step must be done within
   10 minutes of the first. A code is accepted within one 30-second step either side of now, and only from a later step than the last code the account had accepted (at sign-in, on a setup link's form or as the admin's own code). A changed password or authenticator between the two steps, or the account off when the code is entered, means starting over: the page says the sign-in took too long, and nothing is sent.

- **Backup codes**: 8 per account, each used once.
- **One answer for every other failure.** The page says only "Login failed", after the same work,
  whether the name, the password or the code was wrong, the account is turned off or not set up,
  it is already on 2 devices, or sign-ins are locked. The reason goes to the account's alert channels; when none took it, or the account is turned off or unknown, to the admins ([Alerts](alerts.md#what-is-sent)).
- There is no public sign-up, and a person cannot change their own password or authenticator in
  the app: both go through a setup link or the command line.

## Devices and sessions

- **At most 2 devices** signed in per account. Each completed sign-in adds one; a third is
  refused until one is freed. On a phone, the browser and the home-screen app are two devices.
- **A device is freed** by signing out on it, by the person or an admin revoking it, by any change
  of the account's password or authenticator (all its devices), and by turning the account off (all). A session that ends by itself (its 400 days, or its cookie cleared) does not free its device: it stays counted until revoked.
- **A session** lasts while it is used: it is renewed on a request more than 24 hours after its sign-in or last renewal,
  and ends 400 days after its sign-in or last renewal. It ends at once when its device is revoked, the
  account is turned off, or the password or authenticator changes.
- The session cookie is signed, not readable by scripts, sent with the app's own requests and when a link on another site opens one of its pages, not with a form another site posts (SameSite=Lax), and
  marked secure except on an install set up for plain HTTP on a private network.

## Lockout

Every failed check of a password or a code counts, for its network address, its account name and everyone together; a passed check counts nowhere and clears nothing. A check is refused when the failures before it have reached:

| Counted per       | Failures | In         |
| ----------------- | -------- | ---------- |
| network address   | 5        | 15 minutes |
| account name      | 10       | 1 hour     |
| everyone together | 50       | 1 hour     |

- The windows slide: there is no fixed time at which a lock ends.
- The network address is the one the proxy in front of the app reports (`X-Real-IP`, else the first `X-Forwarded-For` entry), whole; requests with neither share one address. The app does not check whether a client can set that header.
- Counted: both sign-in steps, the form of a setup link, and the admin's own code before an account task; a check still running counts as a failure, and so does a right password for a turned-off account. The name counted is the one typed, in lower case (none when it breaks the name rule), the admin's own for the admin's code, and the link's account's for a setup link. A refused check is not counted again, and a sign-in refused for the device limit is not a failure. The command line is neither counted nor locked.
- A locked first step checks no password and takes as long as a checked one; a locked code check answers at once.
- Attempts are kept 30 days, with the address and the name stored as keyed hashes.

Example. Five wrong passwords from one address in 10 minutes: the sixth try from that address is
refused, whatever the name, until the oldest of the five is more than 15 minutes old. The same name tried
from other addresses is refused once it has 10 failures within an hour.

## Roles and what each may do

- An account is an **admin** or a **member**. The first account made is an admin; a later one is an admin or a member as its creator chooses (the Accounts page, or `pnpm user create --admin`). Afterwards a role is changed only at the command line (`pnpm user role <username> admin|member`), never from a page: a change signs the account's devices out, and the only admin who can sign in (an account that is set up and not turned off) cannot be made a member.
- **Every page needs a session**, except the sign-in and setup-link pages and the app's icons.
  Admin pages answer "not found" to a member.
- **Every action checks the session itself**; an admin's action checks the role too. A person can read and change only their own data, each kind [The data model](data-model.md#one-persons-or-shared) marks as one person's. The exceptions are an admin's: the account tasks below on another person (their devices, setup links, turning the account off or on), and on any person's game wish what its owner may do from its check page (the Wishlist chapter of the requirements), which changes the shared item, never the wish's own target, condition or estimate.
- **Shared data**: an item's own details are edited only by the person who made it or an admin; its searches, listing links and which of its sales count by anyone with a lot of it (sold ones included); a game's rules, the words each marketplace is searched with for it, which of its sales and listings count, and its confirmations also by a person with a wish on it, from the wish's check page; a game's page at its identity shop also by a person watching it, or by an admin while the game is tracked; sources and their roles, markets, lists, stores and every other setting only by an admin.
- **Activity**: an admin sees every entry, a member their own.
- **A turned-off account** cannot sign in; its sessions end, its devices are revoked, and its setup link and feed token are refused while it is off (once it is turned back on, the feed token works again, and the setup link if still unused and within its 24 hours; its devices stay revoked). Its data stays. No account is ever deleted.
- **Machines use their own secret, not a session**: the hosted app's daily job and the feed check
  (the cron secret), a person's feed (their feed token), the server's status (the status token).

## Making and resetting accounts

- **Setup links** (Settings > Admin > Accounts): a link works once, for 24 hours; a new link for
  the same person replaces the unused one, and an admin can stop one. A link for a new account or
  a full reset asks for nothing; a link for a new password asks for the current authenticator code
  or a backup code; a link for a new authenticator asks for the current password. Finishing one
  signs every device of the account out, and shows new backup codes when the authenticator
  changed.
- **The admin's own authenticator code** (not a backup code; a code already used, at sign-in too, is refused) is asked before creating an account, making a setup link, and turning
  an account off or on. Signing a person's devices out and stopping a link ask for a confirmation
  only. An admin cannot turn their own account off.
- **The command line** (`pnpm user`, on a machine whose `.env` names the database and holds the app's `AUTH_SECRET`): list, create, reset
  the password, reset the authenticator, list or revoke devices, turn off or on, change a role. Creating and
  resetting an authenticator need one valid code before anything is saved.
- Every account task goes to the activity log.

## The account download

- **Download** (Settings > Your data): the person's lots with today's value and their history,
  manual prices, watches and estimates, imports, purchase links, canceled orders and lottery marks, their name, role, preferences and notice levels, with the items they use and those items' listing links. Never the collected prices, nor a password, authenticator, backup code or token.
- **Loading one** is allowed only into an account with no lots, watches or manual prices, from a
  file of the same format, version and base currency, all or nothing. Rows get new ids, items the install lacks are added with their listing links, preferences and notice levels are loaded, and the name, the role and the sign-in data never are.

## Secrets

- Passwords are stored as scrypt hashes. Backup codes, the lockout's addresses and names and the status token are stored as hashes keyed with `AUTH_SECRET`; setup links and feed tokens as plain hashes of long random values. Backup codes made before 2026-10-31 are plain hashes, accepted until used or replaced, and a new `AUTH_SECRET` does not break them.
- Authenticator secrets, alert channel targets and the Telegram bot's token are encrypted with a
  key derived from `AUTH_SECRET`, which also signs sessions.
- So a new `AUTH_SECRET` signs everyone out and breaks every authenticator and alert channel, the backup codes made since 2026-10-31, the bot's token and the status token. Signing everyone out is done by revoking
  devices, not by changing it.
- With no `AUTH_SECRET`, or one under 32 characters, only the sign-in page is served.

## The MCP server

Runs on a machine whose `.env` names the database, for one account: the one named when it starts (`--user` or `TORA_USER`), or the only account there is (turned-off and not yet set-up ones count); with several accounts and none named it does not start, and it does not check whether that account is turned off. Its ready-made tools read that account's lots, watches and reviews, and never data of sources kept
from models.

Its SQL tool reads every table, every account's rows included: the tables holding no source's data as they are; from the others it leaves out what came from sources kept from models (rows, columns, or a whole table), and of the settings it gives only the ones it lists. It reads the nightly analysis copy, or the database file itself when the app runs on a local file. Whatever the query:

- It only reads tables. It cannot read or write a file, read the database's raw pages, attach
  another database or change anything.
- It never gives what is used to sign in or to reach a person: password and backup code hashes,
  authenticator secrets, the hashes of setup links, feed tokens and the lockout's addresses and
  names, channel targets, the bot's token and the status token. These read as empty; the analysis
  copy has them blanked as well.
- Whether it may read other accounts' rows is the owner's to decide; as built it can.

## Numbers

Each is a choice.

| Number                        | Value                      | In the code                                              | Chosen                                                                                          |
| ----------------------------- | -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Devices per account           | 2                          | `MAX_ACTIVE_DEVICES`                                     | the owner, 2026-10-09                                                                           |
| Password length               | 12 or more                 | `MIN_PASSWORD`                                           | Claude, at build, 2026-10-09                                                                    |
| Name length                   | 3 to 32 characters         | `USERNAME_MIN`, `USERNAME_MAX`                           | Claude, at build, 2026-10-09                                                                    |
| Second step within            | 10 minutes                 | `MFA_MAX_AGE_SECONDS`                                    | Claude, at build, 2026-10-09                                                                    |
| Code accepted                 | one step either side       | set in `totp.ts`                                         | RFC 6238 allows one step of delay (5.2) and a limit both ways (6); Claude, at build, 2026-10-09 |
| Authenticator code            | 6 digits, 30-second steps  | `TOTP_DIGITS`, `TOTP_PERIOD_SECONDS`                     | RFC 4226 and RFC 6238; Claude, at build, 2026-10-09                                             |
| Backup codes                  | 8                          | set in `backup-codes.ts`                                 | Claude, at build, 2026-10-09 (Decision log)                                                     |
| Session: renewed after, ends  | 24 hours, 400 days         | `SESSION_RENEW_AFTER_SECONDS`, `SESSION_MAX_AGE_SECONDS` | renew on use: the owner, 2026-10-09; the numbers: Claude, at build, 2026-10-09                  |
| Secret length                 | 32 characters or more      | `MIN_SECRET_LENGTH`                                      | Claude, at build, 2026-10-09                                                                    |
| Lockout                       | 5 / 15 min, 10 / h, 50 / h | `MAX_FAILURES_PER_IP`, `_PER_USERNAME`, `_GLOBAL`        | Claude, at build, 2026-10-09                                                                    |
| Attempts kept                 | 30 days                    | `RETENTION_MS`                                           | Claude, at build, 2026-10-09                                                                    |
| Setup link                    | 24 hours, one use          | `SETUP_LINK_HOURS`                                       | one use: the owner, 2026-10-20; 24 hours: Claude, at build, 2026-10-20                          |
| A download that can be loaded | up to 50 MB                | `MAX_BYTES` (the import route)                           | Claude, at build, 2026-10-25                                                                    |
