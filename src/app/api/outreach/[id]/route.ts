// ============================================================
// src/app/api/outreach/[id]/route.ts
// PATCH /api/outreach/[id] — Update prospect status or warmup
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as {
    action: 'messaged' | 'skip' | 'warmup_liked' | 'warmup_story' | 'warmup_comment' | 'followup_sent';
    sentText?: string;
  };

  try {
    const now = new Date().toISOString();

    switch (body.action) {
      // ── Mark prospect as messaged ─────────────────────────────────────────
      case 'messaged': {
        if (!body.sentText) {
          return NextResponse.json({ error: 'sentText required' }, { status: 400 });
        }
        await sql`
          UPDATE prospects SET status = 'messaged', updated_at = ${now} WHERE id = ${id}
        `;
        await sql`
          UPDATE prospect_content
          SET sent_at = ${now}, sent_text = ${body.sentText}, updated_at = ${now}
          WHERE prospect_id = ${id}
        `;
        await sql`
          UPDATE radar_memory SET daily_dm_count = daily_dm_count + 1, updated_at = ${now}
          WHERE date = CURRENT_DATE
        `;
        await logAction(id, 'messaged', `DM sent to prospect`);
        break;
      }

      // ── Skip a prospect ──────────────────────────────────────────────────
      case 'skip': {
        await sql`
          UPDATE prospects SET status = 'skipped', updated_at = ${now} WHERE id = ${id}
        `;
        await logAction(id, 'skipped', 'User skipped this prospect');
        break;
      }

      // ── Warmup: liked a post ──────────────────────────────────────────────
      case 'warmup_liked': {
        await sql`
          UPDATE prospects
          SET liked_post = true, liked_post_at = ${now}, updated_at = ${now}
          WHERE id = ${id}
        `;
        await checkWarmupComplete(id, now);
        await logAction(id, 'warmup_liked', 'Liked a post');
        break;
      }

      // ── Warmup: replied to story ──────────────────────────────────────────
      case 'warmup_story': {
        await sql`
          UPDATE prospects
          SET story_reply_sent = true, story_reply_at = ${now}, updated_at = ${now}
          WHERE id = ${id}
        `;
        await checkWarmupComplete(id, now);
        await logAction(id, 'warmup_story', 'Replied to story');
        break;
      }

      // ── Warmup: left a comment ────────────────────────────────────────────
      case 'warmup_comment': {
        await sql`
          UPDATE prospects
          SET post_commented = true, post_commented_at = ${now}, updated_at = ${now}
          WHERE id = ${id}
        `;
        await checkWarmupComplete(id, now);
        await logAction(id, 'warmup_comment', 'Left a post comment');
        break;
      }

      // ── Follow-up sent ────────────────────────────────────────────────────
      case 'followup_sent': {
        if (!body.sentText) {
          return NextResponse.json({ error: 'sentText required' }, { status: 400 });
        }
        await sql`
          UPDATE prospect_content
          SET follow_up_sent_at = ${now}, follow_up_sent_text = ${body.sentText}, updated_at = ${now}
          WHERE prospect_id = ${id}
        `;
        await logAction(id, 'followup_sent', 'Follow-up DM sent');
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    // Return updated prospect
    const [updated] = await sql`
      SELECT p.*, pc.dm_variant_1, pc.dm_variant_1_style,
             pc.dm_variant_2, pc.dm_variant_2_style,
             pc.dm_variant_3, pc.dm_variant_3_style,
             pc.story_reply, pc.post_comment,
             pc.follow_up_dm, pc.sent_at, pc.follow_up_sent_at
      FROM prospects p
      LEFT JOIN prospect_content pc ON pc.prospect_id = p.id
      WHERE p.id = ${id}
    `;

    return NextResponse.json({ ok: true, prospect: updated });

  } catch (err) {
    console.error(`[api/outreach/${id}]`, err);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkWarmupComplete(id: string, now: string) {
  await sql`
    UPDATE prospects
    SET warmup_complete = true, updated_at = ${now}
    WHERE id = ${id}
      AND liked_post = true
      AND story_reply_sent = true
      AND post_commented = true
      AND warmup_complete = false
  `;
}

async function logAction(prospectId: string, action: string, detail: string) {
  await sql`
    INSERT INTO activity_log (source, action, detail, prospect_id)
    VALUES ('connect', ${action}, ${detail}, ${prospectId})
  `;
}
