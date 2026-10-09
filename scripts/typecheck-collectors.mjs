// Typechecks the private collectors/ submodule when it is checked out (it is not a workspace
// member, so `pnpm -r typecheck` does not reach it).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('collectors/tsconfig.json')) {
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'collectors'], { stdio: 'inherit' });
} else {
  console.log('collectors/ not present: skipped');
}
