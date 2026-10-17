import { describe, expect, it } from 'vitest';
import { dbConfigFromEnv } from './env';

describe('dbConfigFromEnv', () => {
  const turso = { DATABASE_URL: 'libsql://x.turso.io', DATABASE_AUTH_TOKEN: 't' };

  it('refuses the hosted database to programs Claude Code starts', () => {
    expect(() => dbConfigFromEnv({ ...turso, CLAUDECODE: '1' })).toThrow(/analysis copy/);
    expect(dbConfigFromEnv(turso)).toEqual({ url: 'libsql://x.turso.io', authToken: 't' });
    // The person's own override, and the MCP server's light tools.
    expect(dbConfigFromEnv({ ...turso, CLAUDECODE: '1', TORA_ALLOW_TURSO: '1' }).url).toBe(
      'libsql://x.turso.io',
    );
    expect(dbConfigFromEnv({ ...turso, CLAUDECODE: '1' }, { allowClaude: true }).url).toBe(
      'libsql://x.turso.io',
    );
  });

  it('leaves local files and servers on this machine alone', () => {
    expect(dbConfigFromEnv({ DATABASE_URL: 'http://127.0.0.1:8099', CLAUDECODE: '1' }).url).toBe(
      'http://127.0.0.1:8099',
    );
    expect(dbConfigFromEnv({ DATABASE_URL: 'file::memory:', CLAUDECODE: '1' }).url).toBe(
      'file::memory:',
    );
  });
});
