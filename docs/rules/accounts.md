# Accounts and access

How a person signs in, what a device and a session are, what stops guessing, what an admin and a
member may see or change, how accounts are made and reset, and what is encrypted with what. This
file is the one home of these rules and their numbers. The code is `packages/auth/src`,
`packages/db/src/users.ts` and `accounts.ts`, `apps/web/src/lib/auth`, `apps/web/src/proxy.ts`
and `packages/db/src/account-data.ts`. Setting up accounts: [Setup](../setup.md).

Not here: the message sent about a failed sign-in ([Alerts](alerts.md#what-is-sent)); what is one
person's and what is shared, table by table ([The data model](data-model.md)); backups of the
whole database ([Backups](../backups.md)).

## Signing in

1. **Name and password.** A name is 3 to 32 characters of a-z, 0-9, dot, underscore and hyphen,
   stored in lower case. A password has 12 characters or more.
2. **A code**: the 6 digits of the authenticator, or a backup code. The step must be done within
   10 minutes of the first. A code is accepted within one 30-second step either side of now and
   only once. A changed password or authenticator between the two steps means starting over.

- **Backup codes**: 8 per account, each used once.
- **One answer for every failure.** The page says only "Login failed", after the same work,
  whether the name, the password or the code was wrong, the account is turned off or not set up,
  it is already on 2 devices, or sign-ins are locked. The reason goes to the account's alert
  channels, else to the admins.
- There is no public sign-up, and a person cannot change their own password or authenticator in
  the app: both go through a setup link or the command line.

## Devices and sessions

- **At most 2 devices** signed in per account. Each completed sign-in adds one; a third is
  refused until one is freed. On a phone, the browser and the home-screen app are two devices.
- **A device is freed** by signing out on it, by the person or an admin revoking it, by any change
  of the account's password or authenticator (all its devices), and by turning the account off
  (all).
- **A session** lasts while it is used: it is renewed on a request when it is over 24 hours old,
  and ends 400 days after its last renewal. It ends at once when its device is revoked, the
  account is turned off, or the password or authenticator changes.
- The session cookie is signed, not readable by scripts, sent on same-site navigation only, and
  marked secure except on an install set up for plain HTTP on a private network.

## Lockout

Every check of a password or a code counts. A check is refused when the failures before it have
reached:

| Counted per       | Failures | In         |
| ----------------- | -------- | ---------- |
| network address   | 5        | 15 minutes |
| account name      | 10       | 1 hour     |
| everyone together | 50       | 1 hour     |

- The windows slide: there is no fixed time at which a lock ends.
- Counted: both sign-in steps, the form of a setup link, and the admin's own code before an
  account task. A refused check is not counted again.
- A locked sign-in checks no password and takes as long as a checked one.
- Attempts are kept 30 days, with the address and the name stored as keyed hashes.

Example. Five wrong passwords from one address in 10 minutes: the sixth try from that address is
refused, whatever the name, until the oldest of the five is 15 minutes old. The same name tried
from other addresses is refused once it has 10 failures within an hour.

## Roles and what each may do

- An account is an **admin** or a **member**. The first account made is an admin. No command or
  page changes a role afterwards.
- **Every page needs a session**, except the sign-in and setup-link pages and the app's icons.
  Admin pages answer "not found" to a member.
- **Every action checks the session itself**; an admin's action checks the role too. A person can
  read and change only their own lots, prices, watches, imports, channels and preferences.
- **Shared data**: an item is edited only by the person who made it or an admin; sources, roles,
  markets, lists, stores and every other setting only by an admin.
- **Activity**: an admin sees every entry, a member their own.
- **A turned-off account** cannot sign in; its sessions end, its devices are revoked, and its
  setup link and feed token are refused. Its data stays. No account is ever deleted.
- **Machines use their own secret, not a session**: the hosted app's daily job and the feed check
  (the cron secret), a person's feed (their feed token), the server's status (the status token).

## Making and resetting accounts

- **Setup links** (Settings > Admin > Accounts): a link works once, for 24 hours; a new link for
  the same person replaces the unused one, and an admin can stop one. A link for a new account or
  a full reset asks for nothing; a link for a new password asks for the current authenticator code
  or a backup code; a link for a new authenticator asks for the current password. Finishing one
  signs every device of the account out, and shows new backup codes when the authenticator
  changed.
- **The admin's own code** is asked before creating an account, making a setup link, and turning
  an account off or on. Signing a person's devices out and stopping a link ask for a confirmation
  only. An admin cannot turn their own account off.
- **The command line** (`pnpm user`, on the machine holding the database): list, create, reset
  the password, reset the authenticator, list or revoke devices, turn off or on. Creating and
  resetting an authenticator need one valid code before anything is saved.
- Every account task goes to the activity log.

## The account download

- **Download** (Settings > Your data): the person's lots with today's value and their history,
  manual prices, watches and estimates, imports, purchase links, canceled orders and lottery
  marks, with the items they use. Never the collected prices, nor anything used to sign in.
- **Loading one** is allowed only into an account with no lots, watches or manual prices, from a
  file of the same format, version and base currency, all or nothing. Rows get new ids, items the
  install lacks are added, and the role and the sign-in data are never loaded.

## Secrets

- Passwords are stored as scrypt hashes. Backup codes, the lockout's addresses and names and the
  status token are stored as keyed hashes; setup links and feed tokens as plain hashes of long
  random values.
- Authenticator secrets, alert channel targets and the Telegram bot's token are encrypted with a
  key derived from `AUTH_SECRET`, which also signs sessions.
- So a new `AUTH_SECRET` signs everyone out and breaks every authenticator, backup code, alert
  channel, the bot's token and the status token. Signing everyone out is done by revoking
  devices, not by changing it.
- With no `AUTH_SECRET`, or one under 32 characters, only the sign-in page is served.

## The MCP server

Runs on the machine holding the database, for one account: the one named when it starts, or the
only one. Its tools read that account's lots, watches and reviews, and never data of sources kept
from models. Its SQL tool reads the shared tables as they are. It must never return what is used
to sign in or to reach a person (password and code hashes, authenticator secrets, tokens, channel
targets). Whether it may read other accounts' lots is the owner's to decide; as built it can.

## Numbers

Each is a choice.

| Number                        | Value                      | In the code                                              | Chosen                |
| ----------------------------- | -------------------------- | -------------------------------------------------------- | --------------------- |
| Devices per account           | 2                          | `MAX_ACTIVE_DEVICES`                                     | the owner, 2026-10-09 |
| Password length               | 12 or more                 | `MIN_PASSWORD`                                           | built 2026-10-09      |
| Second step within            | 10 minutes                 | `MFA_MAX_AGE_SECONDS`                                    | built 2026-10-09      |
| Code accepted                 | one step either side       | set in `totp.ts`                                         | built 2026-10-09      |
| Backup codes                  | 8                          | set in `backup-codes.ts`                                 | decided 2026-10-09    |
| Session: renewed after, ends  | 24 hours, 400 days         | `SESSION_RENEW_AFTER_SECONDS`, `SESSION_MAX_AGE_SECONDS` | built 2026-10-09      |
| Lockout                       | 5 / 15 min, 10 / h, 50 / h | `MAX_FAILURES_PER_IP`, `_PER_USERNAME`, `_GLOBAL`        | built 2026-10-09      |
| Attempts kept                 | 30 days                    | `RETENTION_MS`                                           | built 2026-10-09      |
| Setup link                    | 24 hours, one use          | `SETUP_LINK_HOURS`                                       | the owner, 2026-10-20 |
| A download that can be loaded | up to 50 MB                | set in the import route                                  | built 2026-10-25      |
