// Purchase links pasted in the app (shops without receipt emails); read by the home PC.
import { toTokyoIso } from '@tora/core';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { type PurchaseLink, purchaseLinks } from './schema';

export type PurchaseLinkStatus =
  'pending' | 'imported' | 'matched' | 'duplicate' | 'skipped' | 'failed';

/** "https://jp.mercari.com/item/m123?utm=x#a" -> "https://jp.mercari.com/item/m123". */
export function normalizeLink(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `https://${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Every link found in pasted text (one per line, or shared text with a link inside). */
export function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'「」]+/g) ?? [];
  return [...new Set(found.map(normalizeLink).filter((l): l is string => l !== null))];
}

/** Saves new links as pending; links already saved are left as they are. */
export async function addPurchaseLinks(
  db: Db,
  userId: string,
  urls: string[],
): Promise<{ added: number; known: number }> {
  if (urls.length === 0) return { added: 0, known: 0 };
  const inserted = await db
    .insert(purchaseLinks)
    .values(urls.map((url) => ({ userId, url })))
    .onConflictDoNothing()
    .returning({ id: purchaseLinks.id });
  return { added: inserted.length, known: urls.length - inserted.length };
}

/** The user's links, newest first. */
export async function purchaseLinksOf(
  db: Db,
  userId: string,
  limit = 100,
): Promise<PurchaseLink[]> {
  return db
    .select()
    .from(purchaseLinks)
    .where(eq(purchaseLinks.userId, userId))
    .orderBy(desc(purchaseLinks.createdAt))
    .limit(limit);
}

/** Links of every user waiting for the home PC, oldest first. */
export async function pendingPurchaseLinks(db: Db): Promise<PurchaseLink[]> {
  return db
    .select()
    .from(purchaseLinks)
    .where(eq(purchaseLinks.status, 'pending'))
    .orderBy(asc(purchaseLinks.createdAt));
}

export async function setPurchaseLinkResult(
  db: Db,
  id: string,
  result: { status: PurchaseLinkStatus; message?: string | null; holdingId?: string | null },
): Promise<void> {
  const now = toTokyoIso();
  await db
    .update(purchaseLinks)
    .set({
      status: result.status,
      message: result.message ?? null,
      holdingId: result.holdingId ?? null,
      processedAt: now,
      updatedAt: now,
    })
    .where(eq(purchaseLinks.id, id));
}

/** Removes links (only the user's own). */
export async function removePurchaseLinks(db: Db, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .delete(purchaseLinks)
    .where(and(eq(purchaseLinks.userId, userId), inArray(purchaseLinks.id, ids)));
}

/** Puts links back in the queue (e.g. a failed read). */
export async function retryPurchaseLinks(db: Db, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(purchaseLinks)
    .set({ status: 'pending', message: null, updatedAt: toTokyoIso() })
    .where(and(eq(purchaseLinks.userId, userId), inArray(purchaseLinks.id, ids)));
}

/** Links that could not be imported and are still listed (the user removes each once added by hand). */
export async function failedPurchaseLinkCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(purchaseLinks)
    .where(and(eq(purchaseLinks.userId, userId), eq(purchaseLinks.status, 'failed')));
  return row?.n ?? 0;
}
