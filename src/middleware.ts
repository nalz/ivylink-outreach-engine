// ============================================================
// middleware.ts — Route guard for all /outreach paths
// ============================================================
// Runs at the edge before any page renders.
// Unauthenticated requests are redirected to /login.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// Routes that are protected
const PROTECTED_PREFIX = '/outreach';

// Routes that are always public (even if accidentally matched)
const PUBLIC_ROUTES = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Always allow public routes through
  if (PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  // Protect all /outreach routes
  if (pathname.startsWith(PROTECTED_PREFIX)) {
    const authenticated = await getSessionFromRequest(req);

    if (!authenticated) {
      const loginUrl = new URL('/login', req.url);
      // Preserve the original destination so we can redirect back after login
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

// Only run middleware on app routes — skip static files and Next internals
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
