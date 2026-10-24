'use client';

import { type ReactNode, createContext, useCallback, useContext } from 'react';

/** What client components need of each source: its name, badge and colour slot. */
export interface SourceDisplay {
  label: string;
  badge: string;
  /** Its colour in the charts' palette (by the registry's priority order). */
  slot: number;
}

const SourcesContext = createContext<Record<string, SourceDisplay>>({});

/** Given by the app layout from the source registry. */
export function SourcesProvider({
  value,
  children,
}: {
  value: Record<string, SourceDisplay>;
  children: ReactNode;
}) {
  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>;
}

/** A source's display, falling back to its key for sources not described. */
export function useSourceDisplay(): (key: string) => SourceDisplay | undefined {
  const sources = useContext(SourcesContext);
  return useCallback((key) => sources[key], [sources]);
}
