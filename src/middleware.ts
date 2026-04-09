// ============================================================
// middleware.ts — Route guard for all /outreach page paths
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// Only the UI page is guarded here — API routes handle their own auth
const PROTECTED_PAGES = ['/outreach'];

// Routes that are always public
const PUBLIC_ROUTES = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Always allow public routes through
  if (PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  // Skip all API routes — they do their own auth and return proper 401s
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Protect /outreach page
  if (PROTECTED_PAGES.some(p => pathname.startsWith(p))) {
    const authenticated = await getSessionFromRequest(req);

    if (!authenticated) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
