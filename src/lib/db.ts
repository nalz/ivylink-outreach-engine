// ============================================================
// lib/db.ts — Neon Postgres client (pooled, typed)
// ============================================================
// Uses @neondatabase/serverless for edge-compatible connections.
// Falls back to pg for Node.js cron worker.
// ============================================================

import { neon, neonConfig } from '@neondatabase/serverless';
import { Pool } from 'pg';
import type {
  Prospect,
  ProspectContent,
  ReadyProspect,
  FollowUpProspect,
  PipelineHealth,
  ScoutMemory,
  RadarMemory,
  AnalystMemory,
  ProspectStatus,
} from '@/types';

// ── Edge / API routes ─────────────────────────────────────────────────────────
// neon() returns a tagged-template sql function; safe for Next.js API routes.
neonConfig.fetchConnectionCache = true;

export const sql = neon(process.env.DATABASE_URL!);

// ── Long-running Node.js worker (radar cron) ──────────────────────────────────
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

// ── Prospects ─────────────────────────────────────────────────────────────────

export async function getReadyQueue(): Promise<ReadyProspect[]> {
  const rows = await sql`SELECT * FROM v_ready_queue`;
  return rows as ReadyProspect[];
}

export async function getFollowUpQueue(): Promise<FollowUpProspect[]> {
  const rows = await sql`SELECT * FROM v_followup_queue`;
  return rows as FollowUpProspect[];
}

export async function getPipelineHealth(): Promise<PipelineHealth> {
  const [row] = await sql`SELECT * FROM v_pipeline_health`;
  return row as PipelineHealth;
}

export async function getProspectById(id: string): Promise<Prospect | null> {
  const [row] = await sql`
    SELECT * FROM prospects WHERE id = ${id}
  `;
  return (row as Prospect) ?? null;
}

export async function getProspectByHandle(handle: string): Promise<Prospect | null> {
  const [row] = await sql`
    SELECT * FROM prospects WHERE handle = ${handle}
  `;
  return (row as Prospect) ?? null;
}

export async function updateProspectStatus(
  id: string,
  status: ProspectStatus,
  extra: Record<string, unknown> = {}
): Promise<void> {
  // Build dynamic SET clause for optional extra fields
  const now = new Date().toISOString();
  await sql`
    UPDATE prospects
    SET status = ${status}, updated_at = ${now}
    WHERE id = ${id}
  `;

  if (Object.keys(extra).length > 0) {
    // Apply extra fields one at a time (safe — values from our own code)
    for (const [col, val] of Object.entries(extra)) {
      await sql`
        UPDATE prospects SET ${sql.unsafe(col)} = ${val as string}, updated_at = ${now}
        WHERE id = ${id}
      `;
    }
  }
}

export async function markProspectMessaged(
  prospectId: string,
  sentText: string
): Promise<void> {
  const now = new Date().toISOString();
  await sql`
    UPDATE prospects SET status = 'messaged', updated_at = ${now}
    WHERE id = ${prospectId}
  `;
  await sql`
    UPDATE prospect_content
    SET sent_at = ${now}, sent_text = ${sentText}, updated_at = ${now}
    WHERE prospect_id = ${prospectId}
  `;
}

export async function markFollowUpSent(
  prospectId: string,
  sentText: string
): Promise<void> {
  const now = new Date().toISOString();
  await sql`
    UPDATE prospect_content
    SET follow_up_sent_at = ${now}, follow_up_sent_text = ${sentText}, updated_at = ${now}
    WHERE prospect_id = ${prospectId}
  `;
}

export async function markWarmupAction(
  prospectId: string,
  action: 'liked_post' | 'story_reply_sent' | 'post_commented'
): Promise<void> {
  const now = new Date().toISOString();
  const atCol = `${action}_at`;
  await sql`
    UPDATE prospects
    SET ${sql.unsafe(action)} = true,
        ${sql.unsafe(atCol)} = ${now},
        updated_at = ${now}
    WHERE id = ${prospectId}
  `;

  // Auto-complete warmup when all three done
  await sql`
    UPDATE prospects
    SET warmup_complete = true, updated_at = ${now}
    WHERE id = ${prospectId}
      AND liked_post = true
      AND story_reply_sent = true
      AND post_commented = true
  `;
}

export async function insertProspect(data: {
  handle: string;
  name?: string;
  bio?: string;
  follower_count?: number;
  following_count?: number;
  post_count?: number;
  discovered_via?: string;
  source_detail?: string;
}): Promise<Prospect> {
  const [row] = await sql`
    INSERT INTO prospects (handle, name, bio, follower_count, following_count,
                           post_count, discovered_via, source_detail)
    VALUES (
      ${data.handle},
      ${data.name ?? null},
      ${data.bio ?? null},
      ${data.follower_count ?? 0},
      ${data.following_count ?? 0},
      ${data.post_count ?? 0},
      ${data.discovered_via ?? null},
      ${data.source_detail ?? null}
    )
    ON CONFLICT (handle) DO NOTHING
    RETURNING *
  `;
  return row as Prospect;
}

export async function upsertProspectContent(
  prospectId: string,
  content: Partial<ProspectContent>
): Promise<void> {
  const now = new Date().toISOString();
  await sql`
    INSERT INTO prospect_content (prospect_id, dm_variant_1, dm_variant_1_style,
      dm_variant_2, dm_variant_2_style, dm_variant_3, dm_variant_3_style,
      story_reply, post_comment, follow_up_dm, follow_up_style, generated_at)
    VALUES (
      ${prospectId},
      ${content.dm_variant_1 ?? null},
      ${content.dm_variant_1_style ?? null},
      ${content.dm_variant_2 ?? null},
      ${content.dm_variant_2_style ?? null},
      ${content.dm_variant_3 ?? null},
      ${content.dm_variant_3_style ?? null},
      ${content.story_reply ?? null},
      ${content.post_comment ?? null},
      ${content.follow_up_dm ?? null},
      ${content.follow_up_style ?? null},
      ${now}
    )
    ON CONFLICT (prospect_id) DO UPDATE SET
      dm_variant_1        = EXCLUDED.dm_variant_1,
      dm_variant_1_style  = EXCLUDED.dm_variant_1_style,
      dm_variant_2        = EXCLUDED.dm_variant_2,
      dm_variant_2_style  = EXCLUDED.dm_variant_2_style,
      dm_variant_3        = EXCLUDED.dm_variant_3,
      dm_variant_3_style  = EXCLUDED.dm_variant_3_style,
      story_reply         = EXCLUDED.story_reply,
      post_comment        = EXCLUDED.post_comment,
      follow_up_dm        = EXCLUDED.follow_up_dm,
      follow_up_style     = EXCLUDED.follow_up_style,
      generated_at        = EXCLUDED.generated_at,
      updated_at          = ${now}
  `;
}

// ── System Memory ─────────────────────────────────────────────────────────────

export async function getTodayScoutMemory(): Promise<ScoutMemory> {
  const today = new Date().toISOString().split('T')[0];
  const [existing] = await sql`
    SELECT * FROM scout_memory WHERE date = ${today}
  `;
  if (existing) return existing as ScoutMemory;

  const [created] = await sql`
    INSERT INTO scout_memory (date) VALUES (${today})
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `;
  return created as ScoutMemory;
}

export async function getTodayRadarMemory(): Promise<RadarMemory> {
  const today = new Date().toISOString().split('T')[0];
  const [existing] = await sql`
    SELECT * FROM radar_memory WHERE date = ${today}
  `;
  if (existing) return existing as RadarMemory;

  const [created] = await sql`
    INSERT INTO radar_memory (date) VALUES (${today})
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `;
  return created as RadarMemory;
}

export async function getTodayAnalystMemory(): Promise<AnalystMemory> {
  const today = new Date().toISOString().split('T')[0];
  const [existing] = await sql`
    SELECT * FROM analyst_memory WHERE date = ${today}
  `;
  if (existing) return existing as AnalystMemory;

  const [created] = await sql`
    INSERT INTO analyst_memory (date) VALUES (${today})
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `;
  return created as AnalystMemory;
}

export async function updateRadarMemory(
  patch: Partial<Omit<RadarMemory, 'id' | 'date' | 'created_at'>>
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  if (patch.runs_today !== undefined) {
    await sql`UPDATE radar_memory SET runs_today = ${patch.runs_today}, last_run = ${now}, updated_at = ${now} WHERE date = ${today}`;
  }
  if (patch.daily_dm_count !== undefined) {
    await sql`UPDATE radar_memory SET daily_dm_count = ${patch.daily_dm_count}, updated_at = ${now} WHERE date = ${today}`;
  }
  if (patch.last_action !== undefined) {
    await sql`UPDATE radar_memory SET last_action = ${patch.last_action}, updated_at = ${now} WHERE date = ${today}`;
  }
}

export async function updateScoutMemory(
  patch: Partial<Omit<ScoutMemory, 'id' | 'date' | 'created_at'>>
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  if (patch.daily_discovery_count !== undefined) {
    await sql`UPDATE scout_memory SET daily_discovery_count = ${patch.daily_discovery_count}, updated_at = ${now} WHERE date = ${today}`;
  }
  if (patch.strategy_index !== undefined) {
    await sql`UPDATE scout_memory SET strategy_index = ${patch.strategy_index}, updated_at = ${now} WHERE date = ${today}`;
  }
  if (patch.strategies_used_today !== undefined) {
    await sql`UPDATE scout_memory SET strategies_used_today = ${JSON.stringify(patch.strategies_used_today)}::jsonb, updated_at = ${now} WHERE date = ${today}`;
  }
  if (patch.discovered_handles !== undefined) {
    await sql`UPDATE scout_memory SET discovered_handles = ${JSON.stringify(patch.discovered_handles)}::jsonb, updated_at = ${now} WHERE date = ${today}`;
  }
  if (patch.last_run !== undefined) {
    await sql`UPDATE scout_memory SET last_run = ${patch.last_run}, updated_at = ${now} WHERE date = ${today}`;
  }
}

// ── Activity Log ──────────────────────────────────────────────────────────────

export async function appendLog(entry: {
  source: string;
  action: string;
  detail?: string;
  prospect_id?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await sql`
    INSERT INTO activity_log (source, action, detail, prospect_id, metadata)
    VALUES (
      ${entry.source},
      ${entry.action},
      ${entry.detail ?? null},
      ${entry.prospect_id ?? null},
      ${JSON.stringify(entry.metadata ?? {})}::jsonb
    )
  `;
}

export async function getRecentLogs(limit = 50) {
  return sql`
    SELECT al.*, p.handle
    FROM activity_log al
    LEFT JOIN prospects p ON p.id = al.prospect_id
    ORDER BY al.created_at DESC
    LIMIT ${limit}
  `;
}

// ── Prospects for analyst processing ─────────────────────────────────────────

export async function getProspectsNeedingEnrichment(limit = 10): Promise<Prospect[]> {
  const rows = await sql`
    SELECT * FROM prospects
    WHERE status = 'discovered'
    ORDER BY discovered_at ASC
    LIMIT ${limit}
  `;
  return rows as Prospect[];
}

export async function getProspectsNeedingScoring(limit = 10): Promise<Prospect[]> {
  const rows = await sql`
    SELECT * FROM prospects
    WHERE status = 'enriched'
    ORDER BY discovered_at ASC
    LIMIT ${limit}
  `;
  return rows as Prospect[];
}

export async function bulkUpdateProspectFromApify(
  prospects: Array<{
    handle: string;
    bio?: string;
    follower_count?: number;
    following_count?: number;
    post_count?: number;
  }>
): Promise<number> {
  let inserted = 0;
  for (const p of prospects) {
    const result = await sql`
      INSERT INTO prospects (handle, bio, follower_count, following_count, post_count, discovered_via)
      VALUES (${p.handle}, ${p.bio ?? null}, ${p.follower_count ?? 0},
              ${p.following_count ?? 0}, ${p.post_count ?? 0}, 'hashtag')
      ON CONFLICT (handle) DO NOTHING
    `;
    if (result.length > 0) inserted++;
  }
  return inserted;
}
