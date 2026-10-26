// The audit log (requirements S17): every server action that changes something for the whole app
// (an admin's) writes to the Activity log. A new admin action fails here until it does.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const app = join(__dirname, '../app');

/** Admin actions that change nothing shared, with why. */
const NOT_LOGGED = new Set([
  // Hides a notice for the admin; the source's role stays as the quality gate set it.
  'dismissSourceQualityAction',
  // Anyone holding the item may do it (like linking a page); admins also on items they do not hold.
  'leaveListingGoneAction',
]);

it('records every admin action in the activity log', () => {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === 'actions.ts') files.push(p);
    }
  })(app);
  const missing: string[] = [];
  for (const file of files) {
    const parts = readFileSync(file, 'utf8')
      .split(/^export async function /m)
      .slice(1);
    for (const body of parts) {
      const name = body.match(/^\w+/)![0];
      const admin = /role [!=]== 'admin'|adminOnly\(/.test(body);
      if (admin && !/recordAdminChange\(/.test(body) && !NOT_LOGGED.has(name)) {
        missing.push(`${relative(app, file)}: ${name}`);
      }
    }
  }
  expect(files.length).toBeGreaterThan(5);
  expect(missing).toEqual([]);
});
