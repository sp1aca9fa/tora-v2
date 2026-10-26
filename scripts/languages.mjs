// `pnpm languages`: each installed language and how many of en.json's texts it lacks (shown in
// English meanwhile). `pnpm languages fr` prints those fr lacks, in English, as a JSON file to
// translate and merge into apps/web/messages/fr.json (keys, `{placeholders}` and ICU syntax kept).
/* global console, process */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'apps/web/messages';
const load = (code) => JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8'));

/** The texts of `base` that `own` lacks, in `base`'s shape. */
function lacking(base, own = {}) {
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'object') {
      const under = lacking(value, typeof own[key] === 'object' ? own[key] : {});
      if (Object.keys(under).length) out[key] = under;
    } else if (typeof own[key] !== 'string') out[key] = value;
  }
  return out;
}
const count = (tree) =>
  Object.values(tree).reduce((n, v) => n + (typeof v === 'object' ? count(v) : 1), 0);

const english = load('en');
const wanted = process.argv[2];
if (wanted) {
  console.log(JSON.stringify(lacking(english, load(wanted)), null, 2));
} else {
  console.log(`en: ${count(english)} texts`);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
    const code = f.slice(0, -5);
    console.log(`${code}: ${count(lacking(english, load(code)))} lacking (shown in English)`);
  }
}
