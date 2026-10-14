import 'server-only';
import { baseCurrency } from '@tora/core';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { type Money, type MoneySettings, makeMoney } from './money';
import { getRegistry } from './sources';

/** The base currency (set by the admin) and the page's language. */
export const getMoneySettings = cache(async (): Promise<MoneySettings> => ({
  base: baseCurrency(await getRegistry()),
  locale: await getLocale(),
}));

/** Formats amounts for this request (server components). */
export const getMoney = cache(async (): Promise<Money> => makeMoney(await getMoneySettings()));

/** The base currency (amounts typed in forms are in it). */
export const getBase = async () => baseCurrency(await getRegistry());
