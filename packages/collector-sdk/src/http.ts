// Polite HTTP for collectors (requirements section 7): random delay between requests, a request
// cap per run, retries with backoff on 5xx, and an immediate stop on 403/429/captcha.
// A refusal is never worked around (docs/rules/collectors.md, "Refusals"): once a client is
// refused, every later request of it throws that refusal unsent, even when a plug-in caught it.

/** The site refused us (403/429/captcha): stop this source for the run, do not retry. */
export class BlockedError extends Error {
  /** When the refusal came: the site is left alone for the rest of that day ("Refusals"). */
  readonly at = new Date();

  constructor(
    message: string,
    /** Start of the response body, for APIs that also answer 403 for other reasons. */
    readonly body: string = '',
    /** The answer's status (403, 429, or a server error's with a challenge); null: a challenge page. */
    readonly status: number | null = null,
  ) {
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

/**
 * The listing is gone from the site (an item removed, a page that no longer exists). Thrown by a
 * collector, or an HTTP 404 / 410: after a few nights in a row the listing is set aside and its
 * item asks for a new link. Other errors never do (a bug must not unlink listings).
 */
export class ListingGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingGoneError';
  }
}

/** Whether an error says the listing itself is gone. */
export const listingGone = (e: unknown) =>
  e instanceof ListingGoneError ||
  (e instanceof HttpError && (e.status === 404 || e.status === 410));

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
/** A challenge page is an HTML answer under this many characters with a challenge's words. */
const CHALLENGE_MAX_CHARS = 50_000;

const hasMarkers = (body: string) => CAPTCHA_MARKERS.some((m) => m.test(body));

/**
 * Whether a body is a challenge page ("Refusals", "What counts"): an HTML answer under 50,000
 * characters with a challenge's words, or an answer that should be JSON and is not, with them.
 */
function isChallenge(body: string, expectsJson: boolean): boolean {
  if (!hasMarkers(body)) return false;
  if (!expectsJson) return body.length < CHALLENGE_MAX_CHARS;
  try {
    JSON.parse(body);
    return false;
  } catch {
    return true;
  }
}

export interface PoliteHttpOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  maxRequests?: number;
  retries?: number;
  /** A request with no answer by then is tried again like a server error (S15). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called before each attempt, after the pace wait (the daytime job runner's checks and count,
   * S36 B4); throwing stops the request unsent.
   */
  beforeRequest?: () => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export class PoliteHttp {
  requests = 0;
  private last = 0;
  /** The refusal this client got; every later request throws it without being sent. */
  private refused: BlockedError | null = null;
  private readonly o: Required<PoliteHttpOptions>;

  constructor(options: PoliteHttpOptions = {}) {
    this.o = {
      minDelayMs: 2000,
      maxDelayMs: 5000,
      maxRequests: 500,
      retries: 3,
      timeoutMs: 30_000,
      fetchImpl: fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      beforeRequest: async () => {},
      now: Date.now,
      random: Math.random,
      ...options,
    };
  }

  get remaining(): number {
    return this.o.maxRequests - this.requests;
  }

  /** Requests allowed in this run. */
  get limit(): number {
    return this.o.maxRequests;
  }

  /** The refusal that stopped this client, or null while it was never refused. */
  get refusal(): BlockedError | null {
    return this.refused;
  }

  /**
   * Takes back one refusal a plug-in read as something else ("Refusals": a 403 that says the
   * item was deleted is the listing gone), so later requests go out again. Only a 403 answer, the
   * one case the rules allow; a 429 or a challenge page stays a refusal.
   */
  notRefused(error: BlockedError): void {
    if (this.refused === error && error.status === 403) this.refused = null;
  }

  private refuse(error: BlockedError): BlockedError {
    this.refused ??= error;
    return error;
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
      if (hasMarkers(body)) throw this.refuse(new BlockedError(`challenge page at ${url}`));
      throw new Error(`invalid JSON from ${url}`);
    }
  }

  /** POSTs a JSON body and parses the JSON answer (e.g. a search API). */
  async postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.request(
      url,
      { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      { method: 'POST', body: JSON.stringify(body) },
    );
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      if (hasMarkers(text)) throw this.refuse(new BlockedError(`challenge page at ${url}`));
      throw new Error(`invalid JSON from ${url}`);
    }
  }

  /** A binary file (e.g. an image) with its content type. */
  async bytes(url: string): Promise<{ data: Buffer; contentType: string | null }> {
    const res = await this.request(url, { Accept: 'image/*,*/*;q=0.8' });
    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type'),
    };
  }

  private async request(
    url: string,
    headers: Record<string, string>,
    init: { method?: string; body?: string } = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (this.refused) throw this.refused;
      if (this.requests >= this.o.maxRequests) throw new RequestCapError();
      await this.pace();
      await this.o.beforeRequest();
      this.requests++;
      let res: Response;
      try {
        res = await this.o.fetchImpl(url, {
          ...init,
          headers: { ...BROWSER_HEADERS, ...headers },
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
      } catch (e) {
        // A site that took the connection and went silent would hold the run (and its lock) for
        // minutes per request.
        if (!(e instanceof Error && e.name === 'TimeoutError')) throw e;
        if (attempt < this.o.retries) {
          await this.o.sleep(2 ** attempt * 5000);
          continue;
        }
        throw new Error(`no answer within ${this.o.timeoutMs / 1000} s from ${url}`);
      }
      if (res.status === 403 || res.status === 429) {
        const body = await res.text().catch(() => '');
        throw this.refuse(
          new BlockedError(`HTTP ${res.status} for ${url}`, body.slice(0, 500), res.status),
        );
      }
      if (res.status >= 500) {
        // A server error's challenge page is looked for before any retry: a 503 challenge is a
        // refusal, never tried again. Other error answers (a 404 or 410 page that mentions a
        // captcha) are not read for it: they stay the error they are ("Refusals", "What counts").
        const body = await res.text().catch(() => '');
        if (isChallenge(body, (headers.Accept ?? '').includes('json')))
          throw this.refuse(
            new BlockedError(
              `challenge page (HTTP ${res.status}) at ${url}`,
              body.slice(0, 500),
              res.status,
            ),
          );
        if (attempt < this.o.retries) {
          await this.o.sleep(2 ** attempt * 5000);
          continue;
        }
        throw new HttpError(res.status, url);
      }
      if (!res.ok) throw new HttpError(res.status, url);
      if ((headers.Accept ?? '').includes('html')) {
        const body = await res.clone().text();
        if (hasMarkers(body) && body.length < CHALLENGE_MAX_CHARS) {
          throw this.refuse(new BlockedError(`challenge page at ${url}`));
        }
      }
      return res;
    }
  }

  private async pace(): Promise<void> {
    if (this.last) {
      const { minDelayMs: min, maxDelayMs: max } = this.o;
      const wait = min + this.o.random() * (max - min) - (this.o.now() - this.last);
      if (wait > 0) await this.o.sleep(wait);
    }
    this.last = this.o.now();
  }
}

/**
 * A short error message: the underlying reason, not a wrapper. Database errors print the whole
 * query with its values, which hid the actual cause in the collect log.
 */
export function errorText(error: unknown): string {
  let e: unknown = error;
  while (e instanceof Error && e.cause && /^Failed query/.test(e.message)) e = e.cause;
  const text =
    e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}
