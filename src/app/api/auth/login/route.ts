// ============================================================
// app/api/auth/login/route.ts
// ============================================================
// POST /api/auth/login  { key: string }
// Validates against UI_ADMIN_KEY, issues a signed JWT cookie.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const submittedKey = String(body?.key ?? '').trim();

    const adminKey = process.env.UI_ADMIN_KEY;
    if (!adminKey) {
      console.error('[auth] UI_ADMIN_KEY environment variable is not set');
      return NextResponse.json(
        { error: 'Server misconfiguration' },
        { status: 500 }
      );
    }

    // Constant-time comparison to prevent timing attacks
    if (!timingSafeEqual(submittedKey, adminKey)) {
      // Small artificial delay to slow brute-force
      await sleep(400 + Math.random() * 200);
      return NextResponse.json(
        { error: 'Invalid access key' },
        { status: 401 }
      );
    }

    const token = await createSessionToken();
    const response = NextResponse.json({ ok: true });
    await setSessionCookie(response, token);
    return response;
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  // Pad both to same length to prevent length-based timing leaks
  const aBytes = new TextEncoder().encode(a.padEnd(128, '\0').slice(0, 128));
  const bBytes = new TextEncoder().encode(b.padEnd(128, '\0').slice(0, 128));
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0 && a.length === b.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
