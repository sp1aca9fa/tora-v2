// `pnpm collect:request`: takes a "collect now" left in the app (requirements S21). Exit 0 when
// one was waiting (the caller then runs a collect), 3 when none. Called at each check of
// scripts/collect-cron.sh (hourly on a server).
import { createDb } from '../client';
import { takeCollectRequest } from '../collect-request';
import { recordCheck } from '../schedule';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { loadTimeZone } from '../registry';

loadRootEnv();
const db = createDb(dbConfigFromEnv());
await loadTimeZone(db);
// Each check is heard from: Settings > Collectors > Schedule works out the next ones.
await recordCheck(db);
const taken = await takeCollectRequest(db);
if (taken) console.log('collect requested in the app: running it now');
process.exit(taken ? 0 : 3);
