'use client';

import { type Taxonomy, resolveTaxonomy } from '@tora/core';
import { type ReactNode, createContext, useContext } from 'react';

const TaxonomyContext = createContext<Taxonomy>(resolveTaxonomy(null));

/** Given by the app layout: the admin's categories, kinds and condition lists (S16). */
export function TaxonomyProvider({ value, children }: { value: Taxonomy; children: ReactNode }) {
  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>;
}

export const useTaxonomy = () => useContext(TaxonomyContext);
