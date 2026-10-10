// Product thumbnails stored in the database (requirements S5c): the app never loads images from
// other sites. URLs carry the image version (`?v=`), so browsers may cache them for good.
import { getProductImage } from '@tora/db';
import { currentSession } from '@/lib/auth/guard';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return new Response(null, { status: 401 });
  const image = await getProductImage(session.db, (await params).id);
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      // Private: the app is behind sign-in, so only the browser caches it.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
