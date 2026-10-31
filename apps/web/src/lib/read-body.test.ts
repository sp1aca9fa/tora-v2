import { expect, it } from 'vitest';
import { readTextUpTo } from './read-body';

/** A streamed body (Node needs `duplex`, which the DOM types do not list yet). */
const post = (body: ReadableStream<Uint8Array>) =>
  new Request('http://localhost/import', { method: 'POST', body, duplex: 'half' } as RequestInit);

/** A chunked body: no content-length header. */
function streamed(parts: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
  return post(body);
}

it('reads a body up to the limit, whole characters across chunks', async () => {
  const yen = new TextEncoder().encode('¥');
  const split = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(yen.slice(0, 1));
      controller.enqueue(yen.slice(1));
      controller.close();
    },
  });
  expect(await readTextUpTo(post(split), 10)).toBe('¥');
  expect(await readTextUpTo(streamed(['{"a":', '1}']), 7)).toBe('{"a":1}');
});

it('stops once a chunked body passes the limit', async () => {
  expect(await readTextUpTo(streamed(['12345', '67890', 'x']), 10)).toBeNull();
});

it('reads an empty or missing body as empty text', async () => {
  expect(await readTextUpTo(streamed([]), 10)).toBe('');
  expect(await readTextUpTo(new Request('http://localhost/import', { method: 'POST' }), 10)).toBe(
    '',
  );
});
