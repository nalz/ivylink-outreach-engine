// ============================================================
// lib/auth.ts — Single-user session management
// ============================================================
// Strategy: stateless signed token stored in an HttpOnly cookie.
// No DB. One valid key: process.env.UI_ADMIN_KEY.
// ============================================================

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'outreach_session';
const ALGORITHM  = 'HS256';

// Derive a fixed-length key from the env var
function getJwtSecret(): Uint8Array {
  const key = process.env.JWT_SECRET ?? process.env.UI_ADMIN_KEY ?? 'change-me-in-prod';
  return new TextEncoder().encode(key.padEnd(32, '!').slice(0, 32));
}

// ── Token creation ────────────────────────────────────────────────────────────

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getJwtSecret());
}

// ── Token verification ────────────────────────────────────────────────────────

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getJwtSecret());
    return true;
  } catch {
    return false;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export async function setSessionCookie(response: NextResponse, token: string): Promise<void> {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,  // 24 hours
    path: '/',
  });
}

export async function clearSessionCookie(response: NextResponse): Promise<void> {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

export async function getSessionFromRequest(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

// ── Server component helper ───────────────────────────────────────────────────

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

export { COOKIE_NAME };
