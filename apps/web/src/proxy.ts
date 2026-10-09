import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, authConfigFromEnv, verifySessionToken } from './lib/auth/session';

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, authConfigFromEnv())) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login page and public static assets (PWA manifest and icons must
  // load without credentials).
  matcher: [
    '/((?!login|_next/static|_next/image|icons/|manifest\\.webmanifest|favicon\\.ico|icon\\.svg|apple-icon).*)',
  ],
};
