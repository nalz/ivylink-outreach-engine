// ============================================================
// src/app/api/outreach/queue/route.ts
// GET /api/outreach/queue — Returns ready + follow-up queues
// ============================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [ready, followUp, health] = await Promise.all([
      sql`SELECT * FROM v_ready_queue`,
      sql`SELECT * FROM v_followup_queue`,
      sql`SELECT * FROM v_pipeline_health`,
    ]);

    return NextResponse.json({
      ready,
      followUp,
      health: health[0] ?? {},
    });
  } catch (err) {
    console.error('[api/queue]', err);
    return NextResponse.json({ error: 'Failed to load queue' }, { status: 500 });
  }
}
