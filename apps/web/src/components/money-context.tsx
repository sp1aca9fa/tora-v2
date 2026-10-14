'use client';

import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { type Money, type MoneySettings, makeMoney } from '@/lib/money';

const MoneyContext = createContext<MoneySettings>({ base: 'JPY', locale: 'ja' });

/** Given by the app layout (requirements S16: the base currency). */
export function MoneyProvider({ value, children }: { value: MoneySettings; children: ReactNode }) {
  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

/** Formats amounts in client components, like `getMoney` on the server. */
export function useMoney(): Money {
  const settings = useContext(MoneyContext);
  return useMemo(() => makeMoney(settings), [settings]);
}
