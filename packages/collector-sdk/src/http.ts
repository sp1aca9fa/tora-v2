// Polite HTTP for collectors (requirements section 7): random delay between requests, a request
// cap per run, retries with backoff on 5xx, and an immediate stop on 403/429/captcha.

/** The site refused us (403/429/captcha): stop this source for the run, do not retry. */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

/** The per-run request budget is used up. */
export class RequestCapError extends Error {
  constructor() {
    super('request cap reached');
    this.name = 'RequestCapError';
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
};

const CAPTCHA_MARKERS = [/captcha/i, /cf-challenge/i, /Just a moment\.\.\./, /Access denied/i];

export interface PoliteHttpOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  maxRequests?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class PoliteHttp {
  requests = 0;
  private last = 0;
  private readonly o: Required<PoliteHttpOptions>;

  constructor(options: PoliteHttpOptions = {}) {
    this.o = {
      minDelayMs: 2000,
      maxDelayMs: 5000,
      maxRequests: 500,
      retries: 3,
      fetchImpl: fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
  }

  get remaining(): number {
    return this.o.maxRequests - this.requests;
  }

  async text(url: string, headers: Record<string, string> = {}): Promise<string> {
    return (await this.request(url, { Accept: 'text/html', ...headers })).text();
  }

  async json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.request(url, { Accept: 'application/json', ...headers });
    const body = await res.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      if (CAPTCHA_MARKERS.some((m) => m.test(body)))
        throw new BlockedError(`challenge page at ${url}`);
      throw new Error(`invalid JSON from ${url}`);
    }
  }

  private async request(url: string, headers: Record<string, string>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (this.requests >= this.o.maxRequests) throw new RequestCapError();
      await this.pace();
      this.requests++;
      const res = await this.o.fetchImpl(url, { headers: { ...BROWSER_HEADERS, ...headers } });
      if (res.status === 403 || res.status === 429) {
        throw new BlockedError(`HTTP ${res.status} for ${url}`);
      }
      if (res.status >= 500 && attempt < this.o.retries) {
        await this.o.sleep(2 ** attempt * 5000);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      if ((headers.Accept ?? '').includes('html')) {
        const body = await res.clone().text();
        if (CAPTCHA_MARKERS.some((m) => m.test(body)) && body.length < 50_000) {
          throw new BlockedError(`challenge page at ${url}`);
        }
      }
      return res;
    }
  }

  private async pace(): Promise<void> {
    if (this.last) {
      const { minDelayMs: min, maxDelayMs: max } = this.o;
      const wait = min + Math.random() * (max - min) - (Date.now() - this.last);
      if (wait > 0) await this.o.sleep(wait);
    }
    this.last = Date.now();
  }
}
