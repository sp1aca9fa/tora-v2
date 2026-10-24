// Store post pictures stored in the database (requirements S25), kept a week: the app never
// loads images from the boards. A picture never changes, so browsers may cache it for good.
import { getPostImage } from '@tora/db';
import { currentSession } from '@/lib/auth/guard';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return new Response(null, { status: 401 });
  const image = await getPostImage(session.db, (await params).id);
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'X-Content-Type-Options': 'nosniff',
      // Private: the app is behind sign-in, so only the browser caches it.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
