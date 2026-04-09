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
const MAX_PROSPECTS_PER_RUN = 30; // handle a full scout batch in one run

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalystResult {
  prospect_id: string;
  collab_track: 'A' | 'B';
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
    post_comment_url: string | null;
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

  // Fetch prospects needing processing
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
    notes: string | null;
  }>(`
    SELECT id, handle, name, bio, follower_count, following_count,
           post_count, discovered_via, source_detail, status,
           has_booking_link, uses_stories,
           recent_captions, collab_signals, local_signals, content_themes, notes
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
      // Parse track + structured posts + google reviews from notes field
      let track: 'A' | 'B' = 'B';
      let structuredPosts: ProspectProfileInput['structured_posts'] = [];
      let googleReviews: ProspectProfileInput['google_reviews'] = null;
      if (p.notes) {
        try {
          const notes = JSON.parse(p.notes) as { track?: string; structured_posts?: unknown[]; google_reviews?: unknown };
          track = notes.track === 'A' ? 'A' : 'B';
          const rawPosts = (notes.structured_posts ?? []) as Array<{
            days_ago?: number; caption?: string; type?: string; url?: string;
            tagged?: string[]; location?: string; hashtags?: string[];
          }>;

          // Code-level filter — strip posts that would cause hallucination
          // before they ever reach Claude. Prompt rules alone are not reliable enough.
          const genericPhrases = [
            'meet the founder', 'meet the team', 'introducing ourselves',
            'heart and soul', 'our mission', 'our goal', 'our belief',
            're-introducing', 'building something', 'who we are',
            'card on file', 'no-show', 'cancellation policy',
            'we are hiring', 'now hiring', 'job opening',
          ];

          structuredPosts = rawPosts.filter(post => {
            // Remove posts older than 90 days (pinned or not — too stale for comments)
            if ((post.days_ago ?? 999) > 90) return false;
            // Remove posts with clearly generic/non-treatment captions
            const caption = (post.caption ?? '').toLowerCase();
            if (genericPhrases.some(phrase => caption.includes(phrase))) return false;
            // Keep posts with at least some caption content
            if (caption.trim().length < 20) return false;
            return true;
          }).map(post => ({
            type: post.type ?? '',
            days_ago: post.days_ago ?? 0,
            caption: post.caption ?? '',
            url: post.url ?? '',
            tagged: post.tagged ?? [],
            location: post.location ?? '',
            hashtags: post.hashtags ?? [],
          })) as ProspectProfileInput['structured_posts'];

          console.log(`[analyst] @${p.handle}: ${rawPosts.length} raw posts → ${structuredPosts?.length ?? 0} after filtering`);

          // Parse Google Reviews if present
          if (notes.google_reviews) {
            try {
              googleReviews = notes.google_reviews as ProspectProfileInput['google_reviews'];
            } catch { /* ignore malformed review data */ }
          }
        } catch {
          // notes not JSON — default to Track B
        }
      }

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
        collab_track: track,
        has_booking_link: p.has_booking_link,
        uses_stories: p.uses_stories,
        structured_posts: structuredPosts,
        recent_captions: p.recent_captions ?? [],
        collab_signals: p.collab_signals ?? [],
        local_signals: p.local_signals ?? [],
        content_themes: p.content_themes ?? [],
        google_reviews: googleReviews,
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

      // Analyst never rejects — scout already qualified these accounts.
      // If Claude returns "rejected", override to "scored" so it shows in hold queue.
      const safeStatus = result.status === 'rejected' ? 'scored' : result.status;

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
        safeStatus,
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

      // Always persist content — analyst never rejects, every prospect gets copy
      const hasContent = (
        result.content.dm_variant_1 ||
        result.content.story_reply ||
        result.content.post_comment
      );

      if (hasContent) {
        // Truncate style codes — schema expects short strings, max 15 chars to fit "bio_fallback"
        const s = (v: string | null) => v ? v.slice(0, 15) : null;
        // Store post_comment_url in generation_notes so UI can link to correct post
        const generationNotes = JSON.stringify({
          notes: result.content.generation_notes,
          post_comment_url: result.content.post_comment_url ?? null,
        });
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
          s(result.content.dm_variant_1_style),
          result.content.dm_variant_2,
          s(result.content.dm_variant_2_style),
          result.content.dm_variant_3,
          s(result.content.dm_variant_3_style),
          result.content.story_reply,
          result.content.post_comment,
          result.content.follow_up_dm,
          s(result.content.follow_up_style),
          MODEL,
          generationNotes,
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

      console.log(`[analyst] @${p.handle} → ${safeScore} pts (${safeStatus}) Track ${result.collab_track ?? track}`);

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