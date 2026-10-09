import { type NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_RENEW_AFTER_SECONDS,
  authConfigFromEnv,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from './lib/auth/session';

export async function proxy(request: NextRequest) {
  const config = authConfigFromEnv();
  const claims = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, config);

  if (claims && config) {
    const response = NextResponse.next();
    // Sliding renewal: sessions never expire while the device keeps using the app.
    if (Date.now() / 1000 - claims.issuedAt > SESSION_RENEW_AFTER_SECONDS) {
      const { issuedAt: _, ...rest } = claims;
      response.cookies.set(
        SESSION_COOKIE,
        await createSessionToken(config, rest),
        sessionCookieOptions(),
      );
    }
    return response;
  }

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login pages and public static assets (PWA manifest and icons must
  // load without credentials).
  matcher: [
    '/((?!login|_next/static|_next/image|icons/|manifest\\.webmanifest|favicon\\.ico|icon\\.svg|apple-icon).*)',
  ],
};
