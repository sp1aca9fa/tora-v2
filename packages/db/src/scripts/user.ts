// `pnpm user <command>`: account management from the home PC (there is no sign-up page).
//
//   pnpm user list
//   pnpm user create <username> [--admin]   password + authenticator enrollment + backup codes
//   pnpm user reset-password <username>     also signs out every device
//   pnpm user reset-2fa <username>          new authenticator + backup codes; signs out devices
//   pnpm user devices <username>
//   pnpm user revoke <username> <device-id|all>
//   pnpm user disable|enable <username>
//
// AUTH_SECRET in .env must equal the one on Vercel: it encrypts the authenticator secrets.
import {
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashPassword,
  normalizeUsername,
  otpauthUri,
  verifyTotp,
} from '@tora/auth';
import { createInterface } from 'node:readline/promises';
import QRCode from 'qrcode';
import { createDb } from '../client';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';
import {
  createUser,
  getUserByUsername,
  listDevices,
  listUsers,
  revokeAllDevices,
  revokeDevice,
  setUserDisabled,
  updateCredentials,
} from '../users';

const MIN_PASSWORD = 12;

loadRootEnv();
const authSecret = process.env.AUTH_SECRET?.trim() ?? '';
const config = dbConfigFromEnv();
const db = createDb(config);
const [command, ...args] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function askPassword(): Promise<string> {
  const password = await promptHidden(`New password (min ${MIN_PASSWORD} characters): `);
  if (password.length < MIN_PASSWORD) fail('Too short.');
  if ((await promptHidden('Repeat: ')) !== password) fail('Passwords do not match.');
  return hashPassword(password);
}

/** Shows the QR code and requires one valid code before saving, so a bad scan cannot lock you out. */
async function enrollAuthenticator(username: string) {
  if (authSecret.length < 32)
    fail('AUTH_SECRET (32+ chars, same as on Vercel) must be set in .env.');
  const secret = generateTotpSecret();
  const uri = otpauthUri(secret, username);
  console.log('\nScan with your authenticator app (Google Authenticator, 1Password, ...):\n');
  console.log(await QRCode.toString(uri, { type: 'terminal', small: true }));
  console.log(`Or enter this key manually: ${secret.match(/.{1,4}/g)!.join(' ')}\n`);
  for (let attempt = 1; ; attempt++) {
    const code = await prompt('Enter the 6-digit code the app shows: ');
    if (verifyTotp(secret, code) !== null) break;
    if (attempt >= 3) fail('Code did not match. Nothing was saved; run the command again.');
    console.log('That code did not match, try again (check the phone clock is automatic).');
  }
  const backup = generateBackupCodes();
  return { totpSecretEnc: encryptSecret(secret, authSecret), backup };
}

function printBackupCodes(codes: string[]) {
  console.log(
    '\nBackup codes (each works once if you lose the authenticator). Store them offline:',
  );
  for (const c of codes) console.log(`  ${c}`);
  console.log('');
}

async function requireUser(name: string | undefined) {
  const username = normalizeUsername(name ?? '') ?? fail('Usage: give a username.');
  return (await getUserByUsername(db, username)) ?? fail(`No account "${username}".`);
}

console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);

switch (command) {
  case 'list': {
    for (const u of await listUsers(db)) {
      const devices = await listDevices(db, u.id);
      console.log(
        `${u.username.padEnd(20)} ${u.role.padEnd(7)} devices ${devices.length}/2` +
          `${u.disabledAt ? '  DISABLED' : ''}${u.passwordHash ? '' : '  (placeholder, not set up)'}`,
      );
    }
    break;
  }
  case 'create': {
    const username = normalizeUsername(args[0] ?? '');
    if (!username) fail('Usage: pnpm user create <username>  (3-32 chars: a-z 0-9 . _ -)');
    if (await getUserByUsername(db, username)) fail(`"${username}" already exists.`);
    const passwordHash = await askPassword();
    const { totpSecretEnc, backup } = await enrollAuthenticator(username);
    const { user, claimedHoldings } = await createUser(
      db,
      username,
      { passwordHash, totpSecretEnc, backupCodeHashes: backup.hashes },
      args.includes('--admin') ? 'admin' : 'member',
    );
    printBackupCodes(backup.codes);
    console.log(`Created "${user.username}" (${user.role}).`);
    if (claimedHoldings)
      console.log(`Claimed ${claimedHoldings} existing entries from before accounts existed.`);
    break;
  }
  case 'reset-password': {
    const user = await requireUser(args[0]);
    await updateCredentials(db, user.id, { passwordHash: await askPassword() });
    console.log('Password changed. All devices were signed out.');
    break;
  }
  case 'reset-2fa': {
    const user = await requireUser(args[0]);
    const { totpSecretEnc, backup } = await enrollAuthenticator(user.username);
    await updateCredentials(db, user.id, { totpSecretEnc, backupCodeHashes: backup.hashes });
    printBackupCodes(backup.codes);
    console.log('Authenticator replaced. All devices were signed out.');
    break;
  }
  case 'devices': {
    const user = await requireUser(args[0]);
    const devices = await listDevices(db, user.id);
    if (devices.length === 0) console.log('No active devices.');
    for (const d of devices)
      console.log(
        `${d.id}  ${d.label ?? '-'}  since ${d.createdAt.slice(0, 10)}  last seen ${d.lastSeenAt.slice(0, 16)}`,
      );
    break;
  }
  case 'revoke': {
    const user = await requireUser(args[0]);
    if (args[1] === 'all') console.log(`Revoked ${await revokeAllDevices(db, user.id)} device(s).`);
    else if (args[1])
      console.log(
        (await revokeDevice(db, user.id, args[1])) ? 'Revoked.' : 'No such active device.',
      );
    else fail('Usage: pnpm user revoke <username> <device-id|all>');
    break;
  }
  case 'disable':
  case 'enable': {
    const user = await requireUser(args[0]);
    await setUserDisabled(db, user.id, command === 'disable');
    console.log(command === 'disable' ? 'Disabled and signed out.' : 'Enabled.');
    break;
  }
  default:
    console.log(
      'Commands: list | create <username> [--admin] | reset-password <u> | reset-2fa <u> | devices <u> | revoke <u> <id|all> | disable <u> | enable <u>',
    );
}
