// ============================================================
// IvyLink Outreach Engine — Shared Types
// ============================================================

export type ProspectStatus =
  | 'discovered'
  | 'enriched'
  | 'scored'
  | 'ready'
  | 'messaged'
  | 'skipped'
  | 'rejected';

export type DiscoverySource =
  | 'hashtag'
  | 'follower_list'
  | 'comment_mining'
  | 'explore'
  | 'creator_audience';

export type ActivityLevel = 'active' | 'moderate' | 'inactive';
export type PostingFrequency = 'daily' | 'weekly' | 'sporadic';
export type DmStyle = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ScoreBreakdown {
  collab_behavior: number;   // 0–25
  local_relevance: number;   // 0–20
  content_proof: number;     // 0–20
  conversion_intent: number; // 0–15
  engagement_quality: number;// 0–10
  brand_fit: number;         // 0–10
}

export interface Prospect {
  id: string;
  handle: string;
  name: string | null;
  bio: string | null;
  profile_url: string;
  dm_url: string;
  follower_count: number;
  following_count: number;
  post_count: number;
  discovered_at: string;
  discovered_via: DiscoverySource | null;
  source_detail: string | null;
  status: ProspectStatus;
  score: number | null;
  score_collab_behavior: number;
  score_local_relevance: number;
  score_content_proof: number;
  score_conversion_intent: number;
  score_engagement_quality: number;
  score_brand_fit: number;
  score_reasoning: string | null;
  content_themes: string[];
  collab_signals: string[];
  local_signals: string[];
  intent_signals: string[];
  red_flags: string[];
  activity_level: ActivityLevel | null;
  posting_frequency: PostingFrequency | null;
  uses_stories: boolean | null;
  has_booking_link: boolean | null;
  partner_tags: string[];
  liked_post: boolean;
  liked_post_at: string | null;
  story_reply_sent: boolean;
  story_reply_at: string | null;
  post_commented: boolean;
  post_commented_at: string | null;
  warmup_complete: boolean;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProspectContent {
  id: string;
  prospect_id: string;
  dm_variant_1: string | null;
  dm_variant_1_style: DmStyle | null;
  dm_variant_2: string | null;
  dm_variant_2_style: DmStyle | null;
  dm_variant_3: string | null;
  dm_variant_3_style: DmStyle | null;
  primary_dm: string | null;
  primary_dm_style: DmStyle | null;
  story_reply: string | null;
  post_comment: string | null;
  follow_up_dm: string | null;
  follow_up_style: string | null;
  generated_at: string | null;
  sent_at: string | null;
  sent_text: string | null;
  follow_up_sent_at: string | null;
  follow_up_sent_text: string | null;
}

export interface ReadyProspect extends Prospect {
  dm_variant_1: string | null;
  dm_variant_1_style: DmStyle | null;
  dm_variant_2: string | null;
  dm_variant_2_style: DmStyle | null;
  dm_variant_3: string | null;
  dm_variant_3_style: DmStyle | null;
  story_reply: string | null;
  post_comment: string | null;
  content_generated_at: string | null;
}

export interface FollowUpProspect extends Prospect {
  follow_up_dm: string | null;
  dm_sent_at: string | null;
  follow_up_sent_at: string | null;
  days_since_dm: string;
}

export interface PipelineHealth {
  discovered: number;
  enriched: number;
  scored: number;
  ready: number;
  messaged: number;
  skipped: number;
  rejected: number;
  total: number;
}

export interface ScoutMemory {
  id: string;
  date: string;
  daily_discovery_count: number;
  strategy_index: number;
  strategies_used_today: string[];
  discovered_handles: string[];
  refused_runs: number;
  last_run: string | null;
}

export interface RadarMemory {
  id: string;
  date: string;
  runs_today: number;
  daily_dm_count: number;
  last_action: string | null;
  last_run: string | null;
}

export interface AnalystMemory {
  id: string;
  date: string;
  profiles_enriched_today: number;
  profiles_scored_today: number;
  dms_generated_today: number;
  last_run: string | null;
}

export type RadarAction =
  | 'scout'
  | 'analyst_enrich'
  | 'analyst_score'
  | 'connect_prompt'
  | 'random_skip'
  | 'after_hours'
  | 'daily_dm_limit'
  | 'scout_gap'
  | 'idle';
