import { DomainError } from '@tora/db';
import { z } from 'zod';

/** Result of a form server action. `error` is a message key under `errors`. */
export interface FormState {
  error?: string;
  fields?: string[];
}

const trimmed = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t === '' ? undefined : t;
};

/** Accepts "5400", "5,400", "¥5,400", "５４００". */
const yenText = (v: unknown) => {
  const t = trimmed(v);
  if (typeof t !== 'string') return t;
  return t
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[,，¥￥円\s]/g, '');
};

export const optText = z.preprocess(trimmed, z.string().max(1000).optional());
export const reqText = z.preprocess(trimmed, z.string().min(1).max(1000));
export const yen = z.preprocess(yenText, z.coerce.number().int().min(0).max(1e11));
export const optYen = z.preprocess(yenText, z.coerce.number().int().min(0).max(1e11).optional());
export const qty = z.preprocess(trimmed, z.coerce.number().int().min(1).max(100_000));
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
export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): { data: z.infer<S> } | { state: FormState } {
  const result = schema.safeParse(Object.fromEntries(formData));
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
