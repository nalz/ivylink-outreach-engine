// ============================================================
// src/app/api/outreach/queue/route.ts
// GET /api/outreach/queue — Load dashboard data
// Returns ready, hold, followUp queues + pipeline health.
// Protected — requires admin session cookie.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const authenticated = await getSessionFromRequest(req);
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ── Ready queue (status='ready', sorted by score desc) ─────────────────
    const readyRows = await sql`
      SELECT
        p.id, p.handle, p.name, p.bio,
        p.profile_url, p.dm_url,
        p.follower_count, p.score,
        p.score_collab_behavior, p.score_local_relevance,
        p.score_content_proof, p.score_conversion_intent,
        p.score_engagement_quality, p.score_brand_fit,
        p.score_reasoning,
        p.collab_signals, p.local_signals, p.intent_signals,
        p.liked_post, p.story_reply_sent, p.post_commented, p.warmup_complete,
        p.notes,
        pc.dm_variant_1, pc.dm_variant_1_style,
        pc.dm_variant_2, pc.dm_variant_2_style,
        pc.dm_variant_3, pc.dm_variant_3_style,
        pc.story_reply, pc.post_comment,
        pc.generation_notes,
        pc.follow_up_dm
      FROM prospects p
      LEFT JOIN prospect_content pc ON pc.prospect_id = p.id
      WHERE p.status = 'ready'
      ORDER BY p.score DESC, p.discovered_at ASC
    `;

    // ── Hold queue (status='scored', below ready threshold) ────────────────
    const holdRows = await sql`
      SELECT
        p.id, p.handle, p.name, p.bio,
        p.profile_url, p.dm_url,
        p.follower_count, p.score,
        p.score_collab_behavior, p.score_local_relevance,
        p.score_content_proof, p.score_conversion_intent,
        p.score_engagement_quality, p.score_brand_fit,
        p.score_reasoning,
        p.collab_signals, p.local_signals, p.intent_signals,
        p.liked_post, p.story_reply_sent, p.post_commented, p.warmup_complete,
        p.notes,
        pc.dm_variant_1, pc.dm_variant_1_style,
        pc.dm_variant_2, pc.dm_variant_2_style,
        pc.dm_variant_3, pc.dm_variant_3_style,
        pc.story_reply, pc.post_comment,
        pc.generation_notes,
        pc.follow_up_dm
      FROM prospects p
      LEFT JOIN prospect_content pc ON pc.prospect_id = p.id
      WHERE p.status = 'scored'
      ORDER BY p.score DESC, p.discovered_at ASC
    `;

    // ── Follow-up queue (messaged 7+ days ago, no follow-up sent) ──────────
    const followUpRows = await sql`
      SELECT
        p.id, p.handle, p.name, p.bio,
        p.profile_url, p.dm_url,
        p.follower_count, p.score,
        p.collab_signals, p.local_signals, p.intent_signals,
        p.liked_post, p.story_reply_sent, p.post_commented, p.warmup_complete,
        p.notes,
        pc.follow_up_dm,
        pc.sent_at AS dm_sent_at,
        NOW() - pc.sent_at AS days_since_dm
      FROM prospects p
      JOIN prospect_content pc ON pc.prospect_id = p.id
      WHERE
        p.status = 'messaged'
        AND pc.sent_at IS NOT NULL
        AND pc.sent_at < NOW() - INTERVAL '7 days'
        AND pc.follow_up_sent_at IS NULL
        AND pc.follow_up_dm IS NOT NULL
      ORDER BY pc.sent_at ASC
    `;

    // ── Pipeline health ────────────────────────────────────────────────────
    const [health] = await sql`SELECT * FROM v_pipeline_health`;

    return NextResponse.json({
      ready: readyRows,
      hold: holdRows,
      followUp: followUpRows,
      health,
    });

  } catch (err) {
    console.error('[api/outreach/queue]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}