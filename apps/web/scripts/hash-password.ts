// Prompts for a password (hidden) and prints the AUTH_PASSWORD_HASH line for .env / Vercel.
import { hashPassword } from '../src/lib/auth/password';

const MIN_LENGTH = 12;

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

const password = await promptHidden('Password: ');
if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
if ((await promptHidden('Repeat: ')) !== password) {
  console.error('Passwords do not match.');
  process.exit(1);
}
console.log(`\nAUTH_PASSWORD_HASH=${await hashPassword(password)}`);
