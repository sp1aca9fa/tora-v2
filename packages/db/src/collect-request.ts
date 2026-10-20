// "Collect now" (requirements S21): an admin leaves a request in the app; the home PC's hourly
// check (scripts/collect-cron.sh) takes it and runs a collect even when today's already ran.
import { toLocalIso } from '@tora/core';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';

const KEY = 'collectRequest';

export interface CollectRequest {
  requestedAt: string;
  requestedBy: string | null;
  /** When the home PC took it and started the collect. */
  takenAt: string | null;
}

export async function collectRequest(db: Pick<Db, 'select'>): Promise<CollectRequest | null> {
  return readSetting<CollectRequest>(db, KEY);
}

export async function requestCollect(db: Db, userId: string): Promise<void> {
  await saveSetting(db, KEY, { requestedAt: toLocalIso(), requestedBy: userId, takenAt: null });
}

/** The home PC takes a waiting request (true: run a collect now). */
export async function takeCollectRequest(db: Db): Promise<boolean> {
  const request = await collectRequest(db);
  if (!request || request.takenAt) return false;
  await saveSetting(db, KEY, { ...request, takenAt: toLocalIso() });
  return true;
}
