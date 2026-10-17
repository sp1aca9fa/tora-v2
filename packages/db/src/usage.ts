// Rows the hosted database reads and writes (requirements S19), counted from its replies: each
// statement's result carries `rows_read` and `rows_written` (Turso bills them), which the client
// drops, so the client's fetch is wrapped. Counted per day and origin, saved now and then.
import type { Client } from '@libsql/client';
import { basename, extname } from 'node:path';

/** A count in a reply (`{"rows_read":12`); escaped quotes inside values never match. */
const ROW_COUNT = /[,{]"rows_(read|written)":(\d+)/g;
/** Counts are saved at most this often while queries run (and when a program ends). */
const SAVE_EVERY_MS = 30_000;

export function countRows(body: string): { read: number; written: number } {
  let read = 0;
  let written = 0;
  for (const m of body.matchAll(ROW_COUNT)) {
    if (m[1] === 'read') read += Number(m[2]);
    else written += Number(m[2]);
  }
  return { read, written };
}

/** The program's origin: TORA_ORIGIN, else its script's name (collect, backup, ...). */
export function defaultOrigin(): string {
  const env = process.env.TORA_ORIGIN?.trim();
  if (env) return env;
  const script = process.argv[1];
  return script ? basename(script, extname(script)) : 'app';
}

export class UsageMeter {
  private pending = new Map<string, { read: number; written: number }>();
  private lastSave = Date.now();
  private saving: Promise<void> | null = null;
  client: Client | null = null;

  constructor(readonly origin: string) {}

  /** A fetch that counts what each reply reports. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await fetch(input, init);
    if (response.ok && response.headers.get('content-type')?.includes('json')) {
      const { read, written } = countRows(await response.clone().text());
      if (read || written) this.add(read, written);
    }
    return response;
  };

  add(read: number, written: number, day = new Date().toISOString().slice(0, 10)) {
    const p = this.pending.get(day) ?? { read: 0, written: 0 };
    p.read += read;
    p.written += written;
    this.pending.set(day, p);
    if (Date.now() - this.lastSave >= SAVE_EVERY_MS) void this.save().catch(() => {});
  }

  /** Adds the counts so far to `db_usage` (kept for the next try when that fails). */
  async save(): Promise<void> {
    if (this.saving) return this.saving;
    if (!this.client || this.pending.size === 0) return;
    this.lastSave = Date.now();
    const rows = [...this.pending];
    this.pending = new Map();
    this.saving = (async () => {
      try {
        await this.client!.batch(
          rows.map(([day, p]) => ({
            sql: `INSERT INTO db_usage (day, origin, rows_read, rows_written) VALUES (?, ?, ?, ?)
              ON CONFLICT (day, origin) DO UPDATE SET rows_read = rows_read + excluded.rows_read,
              rows_written = rows_written + excluded.rows_written`,
            args: [day, this.origin, p.read, p.written],
          })),
          'write',
        );
      } catch (error) {
        for (const [day, p] of rows) this.add(p.read, p.written, day);
        throw error;
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }
}
