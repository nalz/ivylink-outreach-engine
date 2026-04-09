// ============================================================
// src/app/api/outreach/queue/route.ts
// GET /api/outreach/queue
// Returns ready, hold, and follow-up prospect queues
// plus pipeline health counts for the dashboard.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getSessionFromRequest } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
});

export async function GET(req: NextRequest) {
  const authenticated = await getSessionFromRequest(req);
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [readyRes, holdRes, followUpRes, healthRes] = await Promise.all([
      // Ready: status=ready with content joined
      pool.query(`
        SELECT
          p.id, p.handle, p.name, p.bio,
          'https://instagram.com/' || p.handle || '/' AS profile_url,
          'https://ig.me/m/' || p.handle AS dm_url,
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
          pc.generation_notes
        FROM prospects p
        LEFT JOIN prospect_content pc ON pc.prospect_id = p.id
        WHERE p.status = 'ready'
        ORDER BY p.score DESC, p.discovered_at ASC
      `),

      // Hold: status=scored — below threshold, user reviews manually
      pool.query(`
        SELECT
          p.id, p.handle, p.name, p.bio,
          'https://instagram.com/' || p.handle || '/' AS profile_url,
          'https://ig.me/m/' || p.handle AS dm_url,
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
          pc.generation_notes
        FROM prospects p
        LEFT JOIN prospect_content pc ON pc.prospect_id = p.id
        WHERE p.status = 'scored'
        ORDER BY p.score DESC, p.discovered_at ASC
      `),

      // Follow-up: messaged 7+ days ago, no follow-up sent yet
      pool.query(`
        SELECT
          p.id, p.handle, p.name, p.bio,
          'https://instagram.com/' || p.handle || '/' AS profile_url,
          'https://ig.me/m/' || p.handle AS dm_url,
          p.follower_count, p.score,
          p.score_collab_behavior, p.score_local_relevance,
          p.score_content_proof, p.score_conversion_intent,
          p.score_engagement_quality, p.score_brand_fit,
          p.score_reasoning,
          p.collab_signals, p.local_signals, p.intent_signals,
          p.liked_post, p.story_reply_sent, p.post_commented, p.warmup_complete,
          p.notes,
          pc.follow_up_dm,
          pc.sent_at AS dm_sent_at,
          EXTRACT(DAY FROM NOW() - pc.sent_at)::text AS days_since_dm,
          pc.generation_notes
        FROM prospects p
        JOIN prospect_content pc ON pc.prospect_id = p.id
        WHERE
          p.status = 'messaged'
          AND pc.sent_at IS NOT NULL
          AND pc.sent_at < NOW() - INTERVAL '7 days'
          AND pc.follow_up_sent_at IS NULL
          AND pc.follow_up_dm IS NOT NULL
        ORDER BY pc.sent_at ASC
      `),

      // Pipeline health counts
      pool.query(`SELECT * FROM v_pipeline_health`),
    ]);

    return NextResponse.json({
      ready:    readyRes.rows,
      hold:     holdRes.rows,
      followUp: followUpRes.rows,
      health:   healthRes.rows[0] ?? null,
    });

  } catch (err) {
    console.error('[queue]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}