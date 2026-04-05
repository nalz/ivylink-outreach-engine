// ============================================================
// src/app/api/outreach/queue/route.ts
// GET /api/outreach/queue — Returns ready + follow-up queues
// ============================================================

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Use pool (pg) instead of neon serverless sql tag — more reliable for views
    const [readyRes, followUpRes, healthRes] = await Promise.all([
      pool.query(`
        SELECT p.*,
          pc.dm_variant_1, pc.dm_variant_1_style,
          pc.dm_variant_2, pc.dm_variant_2_style,
          pc.dm_variant_3, pc.dm_variant_3_style,
          pc.story_reply, pc.post_comment,
          pc.generated_at AS content_generated_at
        FROM prospects p
        LEFT JOIN prospect_content pc ON pc.prospect_id = p.id
        WHERE p.status = 'ready'
        ORDER BY p.score DESC, p.discovered_at ASC
      `),
      pool.query(`
        SELECT p.*,
          pc.follow_up_dm,
          pc.sent_at AS dm_sent_at,
          pc.follow_up_sent_at,
          NOW() - pc.sent_at AS days_since_dm
        FROM prospects p
        JOIN prospect_content pc ON pc.prospect_id = p.id
        WHERE p.status = 'messaged'
          AND pc.sent_at IS NOT NULL
          AND pc.sent_at < NOW() - INTERVAL '7 days'
          AND pc.follow_up_sent_at IS NULL
          AND pc.follow_up_dm IS NOT NULL
        ORDER BY pc.sent_at ASC
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'discovered') AS discovered,
          COUNT(*) FILTER (WHERE status = 'enriched')   AS enriched,
          COUNT(*) FILTER (WHERE status = 'scored')     AS scored,
          COUNT(*) FILTER (WHERE status = 'ready')      AS ready,
          COUNT(*) FILTER (WHERE status = 'messaged')   AS messaged,
          COUNT(*) FILTER (WHERE status = 'skipped')    AS skipped,
          COUNT(*) FILTER (WHERE status = 'rejected')   AS rejected,
          COUNT(*) AS total
        FROM prospects
      `),
    ]);

    console.log(`[api/queue] ready=${readyRes.rows.length} followUp=${followUpRes.rows.length} health=${JSON.stringify(healthRes.rows[0])}`);

    return NextResponse.json({
      ready: readyRes.rows,
      followUp: followUpRes.rows,
      health: healthRes.rows[0] ?? {},
    });
  } catch (err) {
    console.error('[api/queue] Error:', err);
    return NextResponse.json({ error: 'Failed to load queue', detail: String(err) }, { status: 500 });
  }
}
