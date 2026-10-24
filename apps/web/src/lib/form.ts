import { toMinor } from '@tora/core';
import { DomainError } from '@tora/db';
import { z } from 'zod';
import { amountFromText } from './money';
import { getBase } from './money-server';

/** Result of a form server action. `error` is a message key under `errors`. */
export interface FormState {
  error?: string;
  fields?: string[];
  /** Values the error message names (e.g. the price sources a link may come from). */
  values?: Record<string, string>;
}

const trimmed = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t === '' ? undefined : t;
};

/** Accepts "5400", "5,400", "¥5,400", "５４００", "12.50" (see `amountFromText`). */
const amountText = (v: unknown) => {
  const t = trimmed(v);
  if (typeof t !== 'string') return t;
  return amountFromText(t) ?? t;
};
/** A typed amount (whole units of the base currency) to its smallest unit, as stored. */
const inBase = async (n: number) => toMinor(n, await getBase());

export const optText = z.preprocess(trimmed, z.string().max(1000).optional());
export const reqText = z.preprocess(trimmed, z.string().min(1).max(1000));
export const amount = z
  .preprocess(amountText, z.coerce.number().min(0).max(1e11))
  .transform(inBase);
export const optAmount = z
  .preprocess(amountText, z.coerce.number().min(0).max(1e11).optional())
  .transform((n) => (n === undefined ? undefined : inBase(n)));
/** Full-width digits ("３") read as their plain forms. */
const wholeText = (v: unknown) => {
  const t = trimmed(v);
  return typeof t === 'string' ? t.normalize('NFKC') : t;
};
export const qty = z.preprocess(wholeText, z.coerce.number().int().min(1).max(100_000));
export const dateText = z.preprocess(trimmed, z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
export const optDateText = z.preprocess(
  trimmed,
  z
    .string()
    .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
    .optional(),
);
export const optEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(trimmed, z.enum(values).optional());
export const reqEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(trimmed, z.enum(values));

/** Parses FormData; on failure returns the invalid field names for the error message. */
export async function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): Promise<{ data: z.infer<S> } | { state: FormState }> {
  const result = await schema.safeParseAsync(Object.fromEntries(formData));
  if (result.success) return { data: result.data };
  const fields = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? '')))].filter(
    Boolean,
  );
  return { state: { error: 'check', fields } };
}

/** Business-rule failures become form errors; anything else (incl. redirects) propagates. */
export async function runDomain<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; state: FormState }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, state: { error: e.code } };
    throw e;
  }
}
