// ============================================================
// app/api/auth/logout/route.ts
// ============================================================

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  await clearSessionCookie(response);
  return response;
}
