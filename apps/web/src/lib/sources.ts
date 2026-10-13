import 'server-only';
import { type SourceRegistry, sourceName } from '@tora/core';
import { getDb, loadSourceRegistry } from '@tora/db';
import { cache } from 'react';

/** The source registry (what the plug-ins describe), read once per request. */
export const getRegistry = cache((): Promise<SourceRegistry> => loadSourceRegistry(getDb()));

/** A source's name for people (its key when it is not described). */
export async function sourceLabels(): Promise<(key: string) => string> {
  const registry = await getRegistry();
  return (key: string) => sourceName(registry, key);
}
