// `pnpm collect`: runs collectors from the home PC. The run loop arrives in S3.
import { loadRootEnv } from '@tora/db/env';
import { loadCollectors } from '../registry';

loadRootEnv();
const { collectors, missing } = await loadCollectors();

for (const dir of missing) console.log(`Collector package not present: ${dir}/ (skipped)`);
if (collectors.length === 0) {
  console.log('No collectors registered. Nothing to do.');
} else {
  console.log(`Registered collectors: ${collectors.map((c) => c.source).join(', ')}`);
}
