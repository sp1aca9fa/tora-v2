/* global console, process, fetch */
// Reads a self-hosted Tora's status from another machine (S10): `TORA_STATUS_URL` (the app's
// address) and `TORA_STATUS_TOKEN` (the read-only token from Settings > Admin > Server), from the
// environment or `.env`. Prints the summary and the end of each log; never the token.
//   node scripts/server-status.mjs [--lines 100] [--log collect] [--json]
import { existsSync, readFileSync } from 'node:fs';

const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*(TORA_STATUS_(?:URL|TOKEN))\s*=\s*"?([^"\s]*)"?\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}
const base = env.TORA_STATUS_URL?.replace(/\/$/, '');
const token = env.TORA_STATUS_TOKEN;
if (!base || !token) {
  console.error('Set TORA_STATUS_URL and TORA_STATUS_TOKEN (in .env).');
  process.exit(1);
}
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const query = new URLSearchParams();
if (arg('lines')) query.set('lines', arg('lines'));
if (arg('log')) query.set('log', arg('log'));
const res = await fetch(`${base}/api/server/status?${query}`, {
  headers: { authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) {
  console.error(`The server answered ${res.status}.`);
  process.exit(1);
}
const s = await res.json();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
const v = s.version;
console.log(`At ${s.at}: version ${v.commit ?? '?'} (${v.date ?? '?'}) ${v.subject ?? ''}`);
console.log(
  `${s.host.platform}, Node ${v.node}; up ${s.host.uptimeHours} h, app ${s.host.appUptimeHours} h; load ${s.host.load.join(' ')}; memory free ${s.host.memoryFreeMb}/${s.host.memoryTotalMb} MB`,
);
for (const d of s.disks) console.log(`disk ${d.name}: ${d.freeGb}/${d.totalGb} GB free`);
console.log(`last collect ${s.last.collect ?? '-'}; last backup ${s.last.backup ?? '-'}`);
if (s.units) {
  console.log('\nservices:');
  for (const u of s.units) console.log(`  ${u.unit}: ${u.active}/${u.sub}`);
  console.log('timers:');
  for (const t of s.timers ?? [])
    console.log(`  ${t.unit}: next ${t.next ?? '-'}, last ${t.last ?? '-'}`);
} else console.log(`services: ${s.unitsError}`);
for (const l of s.logs) console.log(`\n== ${l.name} ==\n${l.lines.join('\n')}`);
