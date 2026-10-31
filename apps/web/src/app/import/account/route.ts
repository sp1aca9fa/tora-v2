// Loads a "Download my data" file into the signed-in, empty account (requirements S15). A route,
// not a server action: a big account's file is over the actions' 5 MB. Only a JSON body is taken,
// which another site's form cannot send.
import { loadAccountData } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { currentSession } from '@/lib/auth/guard';
import { readTextUpTo } from '@/lib/read-body';

/** A collection of several thousand lots is about 12 MB. */
const MAX_BYTES = 50_000_000;

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(null, { status: 401 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: 'format' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return Response.json({ error: 'tooBig' }, { status: 413 });
  }
  const text = await readTextUpTo(request, MAX_BYTES);
  if (text === null) return Response.json({ error: 'tooBig' }, { status: 413 });
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return Response.json({ error: 'format' }, { status: 400 });
  }
  const result = await loadAccountData(session.db, session.user.id, file);
  if ('error' in result) return Response.json(result, { status: 400 });
  revalidatePath('/', 'layout');
  return Response.json(result);
}
