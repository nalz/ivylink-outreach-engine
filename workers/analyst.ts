// ============================================================
// workers/analyst.ts — IvyLink Outreach Analyst
// ============================================================
// Called by radar.ts when discovered/enriched prospects
// need scoring and DM generation.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import {
  ANALYST_SYSTEM_PROMPT,
  buildAnalystUserMessage,
  type ProspectProfileInput,
} from './analyst-prompt';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5';
const MAX_PROSPECTS_PER_RUN = 5; // Keep Claude costs predictable

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalystResult {
  prospect_id: string;
  status: 'ready' | 'scored' | 'rejected';
  priority: 'immediate' | 'queue' | 'hold' | null;
  score: number;
  score_breakdown: {
    collab_behavior: number;
    local_relevance: number;
    content_proof: number;
    conversion_intent: number;
    engagement_quality: number;
    brand_fit: number;
  };
  score_reasoning: string;
  red_flags: string[];
  enrichment: {
    activity_level: 'active' | 'moderate' | 'inactive';
    posting_frequency: 'daily' | 'weekly' | 'sporadic';
    uses_stories: boolean;
    has_booking_link: boolean;
    content_themes: string[];
    collab_signals: string[];
    local_signals: string[];
    intent_signals: string[];
    partner_tags: string[];
  };
  content: {
    dm_variant_1: string | null;
    dm_variant_1_style: string | null;
    dm_variant_2: string | null;
    dm_variant_2_style: string | null;
    dm_variant_3: string | null;
    dm_variant_3_style: string | null;
    story_reply: string | null;
    post_comment: string | null;
    follow_up_dm: string | null;
    follow_up_style: string | null;
    generation_notes: string | null;
  };
}

// ── Core analyst function ─────────────────────────────────────────────────────

export async function analyzeProspect(
  profile: ProspectProfileInput
): Promise<AnalystResult> {
  const userMessage = buildAnalystUserMessage(profile);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: ANALYST_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const rawText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  // Strip any accidental markdown fences
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const result = JSON.parse(cleaned) as AnalystResult;

  // Validate structure
  if (!result.prospect_id || result.score === undefined) {
    throw new Error(`Analyst returned invalid structure for ${profile.handle}`);
  }

  return result;
}

// ── Batch runner (called by radar) ───────────────────────────────────────────

export async function runAnalyst(pool: Pool): Promise<{
  enriched: number;
  scored: number;
  dmsGenerated: number;
  rejected: number;
  errors: number;
}> {
  const stats = { enriched: 0, scored: 0, dmsGenerated: 0, rejected: 0, errors: 0 };

  // Fetch prospects needing processing (discovered or enriched)
  const { rows: prospects } = await pool.query<{
    id: string;
    handle: string;
    name: string | null;
    bio: string | null;
    follower_count: number;
    following_count: number;
    post_count: number;
    discovered_via: string | null;
    source_detail: string | null;
    status: string;
    has_booking_link: boolean | null;
    uses_stories: boolean | null;
    recent_captions: string[];
    collab_signals: string[];
    local_signals: string[];
    content_themes: string[];
  }>(`
    SELECT id, handle, name, bio, follower_count, following_count,
           post_count, discovered_via, source_detail, status,
           has_booking_link, uses_stories,
           recent_captions, collab_signals, local_signals, content_themes
    FROM prospects
    WHERE status IN ('discovered', 'enriched')
    ORDER BY discovered_at ASC
    LIMIT $1
  `, [MAX_PROSPECTS_PER_RUN]);

  if (prospects.length === 0) {
    console.log('[analyst] No prospects to process');
    return stats;
  }

  console.log(`[analyst] Processing ${prospects.length} prospects`);

  for (const p of prospects) {
    try {
      const profile: ProspectProfileInput = {
        prospect_id: p.id,
        handle: p.handle,
        name: p.name,
        bio: p.bio,
        follower_count: p.follower_count,
        following_count: p.following_count,
        post_count: p.post_count,
        discovered_via: p.discovered_via,
        source_detail: p.source_detail,
        link_in_bio: p.has_booking_link ? 'booking link detected' : null,
        // Pass Apify-captured post signals so Claude can score accurately
        recent_posts: (p.recent_captions ?? []).map((caption, i) => ({
          caption_summary: caption,
          post_type: 'photo' as const,
          tagged_accounts: i === 0 ? (p.collab_signals ?? []) : [],
          location_tag: (p.local_signals ?? [])[i] ?? undefined,
        })),
        story_highlights: p.uses_stories ? ['highlights detected'] : [],
        recent_collab_posts: p.collab_signals ?? [],
        location_from_bio: (p.local_signals ?? [])[0] ?? undefined,
      };

      const result = await analyzeProspect(profile);

      const validActivityLevel = ['active', 'moderate', 'inactive'].includes(result.enrichment.activity_level)
        ? result.enrichment.activity_level
        : 'moderate';
      const validPostingFreq = ['daily', 'weekly', 'sporadic'].includes(result.enrichment.posting_frequency)
        ? result.enrichment.posting_frequency
        : 'sporadic';

      // Clamp all score values to their DB check constraint ranges
      const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v ?? 0)));
      const sb = result.score_breakdown;
      const safeScore = clamp(result.score, 0, 100);
      const safeCollab   = clamp(sb.collab_behavior,    0, 25);
      const safeLocal    = clamp(sb.local_relevance,    0, 20);
      const safeContent  = clamp(sb.content_proof,      0, 20);
      const safeConvert  = clamp(sb.conversion_intent,  0, 15);
      const safeEngage   = clamp(sb.engagement_quality, 0, 10);
      const safeBrand    = clamp(sb.brand_fit,          0, 10);

      // Persist score and enrichment
      await pool.query(`
        UPDATE prospects SET
          status = $1,
          score = $2,
          score_collab_behavior = $3,
          score_local_relevance = $4,
          score_content_proof = $5,
          score_conversion_intent = $6,
          score_engagement_quality = $7,
          score_brand_fit = $8,
          score_reasoning = $9,
          red_flags = $10::jsonb,
          activity_level = $11,
          posting_frequency = $12,
          uses_stories = $13,
          has_booking_link = $14,
          content_themes = $15::jsonb,
          collab_signals = $16::jsonb,
          local_signals = $17::jsonb,
          intent_signals = $18::jsonb,
          partner_tags = $19::jsonb,
          rejection_reason = $20,
          updated_at = NOW()
        WHERE id = $21
      `, [
        result.status,
        safeScore,
        safeCollab,
        safeLocal,
        safeContent,
        safeConvert,
        safeEngage,
        safeBrand,
        result.score_reasoning,
        JSON.stringify(result.red_flags),
        validActivityLevel,
        validPostingFreq,
        result.enrichment.uses_stories,
        result.enrichment.has_booking_link,
        JSON.stringify(result.enrichment.content_themes),
        JSON.stringify(result.enrichment.collab_signals),
        JSON.stringify(result.enrichment.local_signals),
        JSON.stringify(result.enrichment.intent_signals),
        JSON.stringify(result.enrichment.partner_tags),
        result.red_flags.length > 0 ? result.red_flags.join('; ') : null,
        p.id,
      ]);

      stats.enriched++;
      stats.scored++;

      // Persist content if generated
      if (result.status !== 'rejected' && result.content.dm_variant_1) {
        await pool.query(`
          INSERT INTO prospect_content (
            prospect_id,
            dm_variant_1, dm_variant_1_style,
            dm_variant_2, dm_variant_2_style,
            dm_variant_3, dm_variant_3_style,
            story_reply, post_comment,
            follow_up_dm, follow_up_style,
            generated_at, model_used, generation_notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12,$13)
          ON CONFLICT (prospect_id) DO UPDATE SET
            dm_variant_1 = EXCLUDED.dm_variant_1,
            dm_variant_1_style = EXCLUDED.dm_variant_1_style,
            dm_variant_2 = EXCLUDED.dm_variant_2,
            dm_variant_2_style = EXCLUDED.dm_variant_2_style,
            dm_variant_3 = EXCLUDED.dm_variant_3,
            dm_variant_3_style = EXCLUDED.dm_variant_3_style,
            story_reply = EXCLUDED.story_reply,
            post_comment = EXCLUDED.post_comment,
            follow_up_dm = EXCLUDED.follow_up_dm,
            follow_up_style = EXCLUDED.follow_up_style,
            generated_at = EXCLUDED.generated_at,
            generation_notes = EXCLUDED.generation_notes,
            updated_at = NOW()
        `, [
          p.id,
          result.content.dm_variant_1,
          result.content.dm_variant_1_style,
          result.content.dm_variant_2,
          result.content.dm_variant_2_style,
          result.content.dm_variant_3,
          result.content.dm_variant_3_style,
          result.content.story_reply,
          result.content.post_comment,
          result.content.follow_up_dm,
          result.content.follow_up_style,
          MODEL,
          result.content.generation_notes,
        ]);

        stats.dmsGenerated++;
      }

      if (result.status === 'rejected') stats.rejected++;

      // Log
      await pool.query(`
        INSERT INTO activity_log (source, action, detail, prospect_id, metadata)
        VALUES ('analyst', $1, $2, $3, $4::jsonb)
      `, [
        `scored_${result.status}`,
        `@${p.handle} → score: ${result.score} (${result.status})`,
        p.id,
        JSON.stringify({ score: result.score, priority: result.priority }),
      ]);

      console.log(`[analyst] @${p.handle} → ${result.score} pts (${result.status})`);

      // Polite delay between Claude calls
      await sleep(1500);

    } catch (err) {
      stats.errors++;
      console.error(`[analyst] Error processing @${p.handle}:`, err);

      await pool.query(`
        INSERT INTO activity_log (source, action, detail, prospect_id)
        VALUES ('analyst', 'error', $1, $2)
      `, [`${err instanceof Error ? err.message : String(err)}`, p.id]);
    }
  }

  // Update analyst memory
  const today = new Date().toISOString().split('T')[0];
  await pool.query(`
    INSERT INTO analyst_memory (date, profiles_enriched_today, profiles_scored_today, dms_generated_today, last_run)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (date) DO UPDATE SET
      profiles_enriched_today = analyst_memory.profiles_enriched_today + $2,
      profiles_scored_today = analyst_memory.profiles_scored_today + $3,
      dms_generated_today = analyst_memory.dms_generated_today + $4,
      last_run = NOW(),
      updated_at = NOW()
  `, [today, stats.enriched, stats.scored, stats.dmsGenerated]);

  return stats;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
