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

  it('counts a challenge page at a server error as a refusal, never retried (K14)', async () => {
    const page = '<html><title>Just a moment...</title></html>';
    const f = fakeFetch([() => new Response(page, { status: 503 }), () => new Response('ok')]);
    const http = new PoliteHttp({ ...fast, fetchImpl: f.impl });
    await expect(http.text('https://x/a')).rejects.toBeInstanceOf(BlockedError);
    expect(f.calls).toHaveLength(1);
    // An answer that should be JSON: a page with a challenge's words, at any status.
    const j = fakeFetch([() => new Response('captcha required', { status: 500 })]);
    const api = new PoliteHttp({ ...fast, fetchImpl: j.impl });
    await expect(api.json('https://x/api')).rejects.toBeInstanceOf(BlockedError);
    expect(j.calls).toHaveLength(1);
  });

  it('retries a server error without a challenge, and fails other error answers', async () => {
    const big = `<html>${'x'.repeat(50_000)} captcha</html>`;
    const f = fakeFetch([
      () => new Response('oops', { status: 503 }),
      () => new Response(big, { status: 503 }),
      () => new Response('ok'),
    ]);
    const http = new PoliteHttp({ ...fast, fetchImpl: f.impl });
    expect(await http.text('https://x/a')).toBe('ok');
    expect(f.calls).toHaveLength(3);
    const json = fakeFetch([() => new Response('{"error":"captcha"}', { status: 404 })]);
    const api = new PoliteHttp({ ...fast, fetchImpl: json.impl });
    await expect(api.json('https://x/api')).rejects.toBeInstanceOf(HttpError);
  });

  it('reads a 404 page that mentions a captcha as an error answer, not a refusal', async () => {
    // A shop's own HTML 404 page with a captcha form in its footer: the item is gone.
    const page = '<html><title>Page not found</title><form class="g-recaptcha"></form></html>';
    for (const status of [404, 410]) {
      const f = fakeFetch([() => new Response(page, { status }), () => new Response('ok')]);
      const http = new PoliteHttp({ ...fast, fetchImpl: f.impl });
      const error = await http.text('https://x/item').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).not.toBeInstanceOf(BlockedError);
      expect(http.refusal).toBeNull();
      // The client goes on.
      expect(await http.text('https://x/next')).toBe('ok');
    }
  });

  it('sends nothing more after a refusal, even when the plug-in caught it (G2)', async () => {
    for (const first of [
      () => new Response('', { status: 403 }),
      () => new Response('<html>captcha</html>', { status: 200 }),
      () => new Response('<html>captcha</html>', { status: 502 }),
    ]) {
      const f = fakeFetch([first, () => new Response('ok'), () => Response.json({})]);
      const http = new PoliteHttp({ ...fast, fetchImpl: f.impl });
      const refusal = await http.text('https://x/a').catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(BlockedError);
      expect(http.refusal).toBe(refusal);
      await expect(http.text('https://x/b')).rejects.toBe(refusal);
      await expect(http.json('https://x/c')).rejects.toBe(refusal);
      await expect(http.bytes('https://x/d')).rejects.toBe(refusal);
      expect(f.calls).toEqual(['https://x/a']);
      expect(http.requests).toBe(1);
    }
    // A challenge found by the JSON reader stops the client too.
    const j = fakeFetch([
      () => new Response('<html>Access denied</html>'),
      () => Response.json({}),
    ]);
    const api = new PoliteHttp({ ...fast, fetchImpl: j.impl });
    await expect(api.json('https://x/a')).rejects.toBeInstanceOf(BlockedError);
    await expect(api.json('https://x/b')).rejects.toBeInstanceOf(BlockedError);
    expect(j.calls).toHaveLength(1);
  });

  it('reads an OK answer that says it is HTML for a challenge, whatever was asked', async () => {
    const page = () =>
      new Response('<html>Just a moment...</html>', { headers: { 'content-type': 'text/html' } });
    const f = fakeFetch([page, () => new Response('ok')]);
    const http = new PoliteHttp({ ...fast, fetchImpl: f.impl });
    await expect(http.bytes('https://x/a.png')).rejects.toBeInstanceOf(BlockedError);
    await expect(http.text('https://x/b')).rejects.toBeInstanceOf(BlockedError);
    expect(f.calls).toEqual(['https://x/a.png']);
    // Asked for JSON only, an answer that parses as JSON is not one, whatever it says it is.
    const j = fakeFetch([
      () => new Response('{"note":"captcha"}', { headers: { 'content-type': 'text/html' } }),
    ]);
    const api = new PoliteHttp({ ...fast, fetchImpl: j.impl });
    expect(await api.json('https://x/c')).toEqual({ note: 'captcha' });
    expect(api.refusal).toBeNull();
    // A picture with challenge words in its bytes is not read for them.
    const b = fakeFetch([
      () => new Response('captcha', { headers: { 'content-type': 'image/png' } }),
    ]);
    expect(
      (await new PoliteHttp({ ...fast, fetchImpl: b.impl }).bytes('https://x/d')).contentType,
    ).toBe('image/png');
  });

  it('lets a plug-in take back a refusal it read as the listing gone', async () => {
    const f = fakeFetch([
      () => new Response('{"code":"ItemDeleted"}', { status: 403 }),
      () => Response.json({ ok: 1 }),
    ]);
    const http = new PoliteHttp({ ...fast, fetchImpl: f.impl });
    const refusal = (await http.json('https://x/a').catch((e: unknown) => e)) as BlockedError;
    // Another error than the one held changes nothing.
    http.notRefused(new BlockedError('other'));
    expect(http.refusal).toBe(refusal);
    http.notRefused(refusal);
    expect(http.refusal).toBeNull();
    expect(await http.json('https://x/b')).toEqual({ ok: 1 });
  });

  it('never takes back a 429 or a challenge page', async () => {
    for (const first of [
      () => new Response('{"code":"ItemDeleted"}', { status: 429 }),
      // A 403 whose kept body holds a challenge's words.
      () => new Response('<html>Just a moment... ItemDeleted</html>', { status: 403 }),
      () => new Response('<html>captcha ItemDeleted</html>', { status: 503 }),
      () => new Response('<html>captcha ItemDeleted</html>'),
    ]) {
      const f = fakeFetch([first, () => Response.json({ ok: 1 })]);
      const http = new PoliteHttp({ ...fast, fetchImpl: f.impl });
      const refusal = (await http.json('https://x/a').catch((e: unknown) => e)) as BlockedError;
      expect(refusal).toBeInstanceOf(BlockedError);
      http.notRefused(refusal);
      expect(http.refusal).toBe(refusal);
      await expect(http.json('https://x/b')).rejects.toBe(refusal);
      expect(f.calls).toEqual(['https://x/a']);
    }
  });

  it('gives up on a site that does not answer, after retrying (S15)', async () => {
    let calls = 0;
    // Answers only when asked to stop, as a site that took the connection and went silent.
    const silent = (async (_url: string, init: RequestInit) => {
      calls++;
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    }) as unknown as typeof fetch;
    const http = new PoliteHttp({ ...fast, timeoutMs: 20, fetchImpl: silent });
    await expect(http.text('https://x/a')).rejects.toThrow(/no answer/);
    expect(calls).toBe(4);
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

describe('errorText', () => {
  it('shows the cause of a failed query, not the query', async () => {
    const { errorText } = await import('./http');
    const wrapped = new Error('Failed query: insert into "price_observations" values (?, ?, ?)', {
      cause: new Error('SQLITE_BUSY: database is locked'),
    });
    expect(errorText(wrapped)).toBe('SQLITE_BUSY: database is locked');
    expect(errorText('x'.repeat(600))).toHaveLength(501);
  });
});
