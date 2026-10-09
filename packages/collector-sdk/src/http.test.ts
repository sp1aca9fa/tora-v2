import { describe, expect, it } from 'vitest';
import { BlockedError, HttpError, PoliteHttp, RequestCapError } from './http';
import { termCoverage, tokens } from './match';

function fakeFetch(responses: (() => Response)[]) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const fast = { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} };

describe('PoliteHttp', () => {
  it('retries 5xx with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const f = fakeFetch([
      () => new Response('oops', { status: 502 }),
      () => Response.json({ ok: 1 }),
    ]);
    const http = new PoliteHttp({
      ...fast,
      fetchImpl: f.impl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(await http.json('https://x/a')).toEqual({ ok: 1 });
    expect(http.requests).toBe(2);
    expect(sleeps).toContain(5000);
  });

  it('stops immediately on 403/429 and captcha pages', async () => {
    for (const res of [
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 403 }),
      () => new Response('<html>Just a moment...</html>', { status: 200 }),
    ]) {
      const http = new PoliteHttp({ ...fast, fetchImpl: fakeFetch([res]).impl });
      await expect(http.text('https://x/a')).rejects.toBeInstanceOf(BlockedError);
    }
  });

  it('enforces the request cap and reports other errors', async () => {
    const http = new PoliteHttp({
      ...fast,
      maxRequests: 1,
      fetchImpl: fakeFetch([() => new Response('', { status: 404 })]).impl,
    });
    await expect(http.text('https://x/a')).rejects.toBeInstanceOf(HttpError);
    await expect(http.text('https://x/b')).rejects.toBeInstanceOf(RequestCapError);
  });

  it('waits between requests', async () => {
    const sleeps: number[] = [];
    const http = new PoliteHttp({
      minDelayMs: 2000,
      maxDelayMs: 2000,
      sleep: async (ms) => void sleeps.push(ms),
      fetchImpl: fakeFetch([() => new Response('a'), () => new Response('b')]).impl,
    });
    await http.text('https://x/1');
    await http.text('https://x/2');
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(1900);
  });
});

describe('match helpers', () => {
  it('tokenizes and scores term coverage', () => {
    expect(tokens('拡張パック「バトルパートナーズ」ボックス')).toEqual([
      '拡張パック',
      'バトルパートナーズ',
      'ボックス',
    ]);
    expect(
      termCoverage(
        ['バトルパートナーズ', 'ボックス'],
        'ポケモンカードゲーム 拡張パック「バトルパートナーズ」ボックス',
      ),
    ).toBe(1);
    expect(
      termCoverage(['バトルパートナーズ', 'ボックス'], '拡張パック「バトルパートナーズ」パック'),
    ).toBe(0.5);
  });
});
