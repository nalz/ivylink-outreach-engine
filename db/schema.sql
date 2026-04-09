-- ============================================================
-- IvyLink Instagram Outreach Engine — Neon PostgreSQL Schema
-- ============================================================
-- Run this once against your Neon database to initialize.
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PROSPECTS TABLE
-- Core lead record. Holds all profile data, score, and status.
-- ============================================================

CREATE TABLE prospects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  handle                VARCHAR(255) UNIQUE NOT NULL,  -- @username without @
  name                  VARCHAR(255),
  bio                   TEXT,
  profile_url           TEXT GENERATED ALWAYS AS ('https://instagram.com/' || handle) STORED,
  dm_url                TEXT GENERATED ALWAYS AS ('https://instagram.com/direct/t/' || handle) STORED,

  -- Scale signals (populated by Apify / analyst enrichment)
  follower_count        INTEGER DEFAULT 0,
  following_count       INTEGER DEFAULT 0,
  post_count            INTEGER DEFAULT 0,

  -- Discovery metadata
  discovered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  discovered_via        VARCHAR(100)    -- hashtag | follower_list | comment_mining | explore | creator_audience
    CHECK (discovered_via IN ('hashtag', 'follower_list', 'comment_mining', 'explore', 'creator_audience')),
  source_detail         TEXT,           -- e.g. "#newjerseymedspa" or "@clinicgrower followers"

  -- Status state machine
  -- discovered → enriched → scored → ready → messaged → skipped | rejected
  status                VARCHAR(50) NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'enriched', 'scored', 'ready', 'messaged', 'skipped', 'rejected')),

  -- Scoring (100-pt model)
  score                 INTEGER CHECK (score >= 0 AND score <= 100),
  score_collab_behavior INTEGER DEFAULT 0 CHECK (score_collab_behavior >= 0 AND score_collab_behavior <= 25),
  score_local_relevance INTEGER DEFAULT 0 CHECK (score_local_relevance >= 0 AND score_local_relevance <= 20),
  score_content_proof   INTEGER DEFAULT 0 CHECK (score_content_proof >= 0 AND score_content_proof <= 20),
  score_conversion_intent INTEGER DEFAULT 0 CHECK (score_conversion_intent >= 0 AND score_conversion_intent <= 15),
  score_engagement_quality INTEGER DEFAULT 0 CHECK (score_engagement_quality >= 0 AND score_engagement_quality <= 10),
  score_brand_fit       INTEGER DEFAULT 0 CHECK (score_brand_fit >= 0 AND score_brand_fit <= 10),
  score_reasoning       TEXT,           -- analyst's 1-2 sentence reasoning for the score

  -- Enrichment signals (JSONB arrays populated by analyst)
  content_themes        JSONB DEFAULT '[]'::jsonb,   -- e.g. ["botox","hydrafacial","events"]
  recent_captions       JSONB DEFAULT '[]'::jsonb,   -- last 5 caption topics (summarized)
  collab_signals        JSONB DEFAULT '[]'::jsonb,   -- e.g. ["tagged @localbusiness 3 days ago"]
  local_signals         JSONB DEFAULT '[]'::jsonb,   -- e.g. ["Hoboken NJ in bio", "tagged #njmedspa"]
  intent_signals        JSONB DEFAULT '[]'::jsonb,   -- e.g. ["booking link active", "\"accepting new clients\""]
  red_flags             JSONB DEFAULT '[]'::jsonb,   -- reasons for caution/rejection
  activity_level        VARCHAR(50)
    CHECK (activity_level IN ('active', 'moderate', 'inactive')),
  posting_frequency     VARCHAR(50)
    CHECK (posting_frequency IN ('daily', 'weekly', 'sporadic')),
  uses_stories          BOOLEAN,
  has_booking_link      BOOLEAN,
  partner_tags          JSONB DEFAULT '[]'::jsonb,   -- tagged business partners found

  -- Warmup tracking (manual actions by the user)
  liked_post            BOOLEAN NOT NULL DEFAULT FALSE,
  liked_post_at         TIMESTAMPTZ,
  story_reply_sent      BOOLEAN NOT NULL DEFAULT FALSE,
  story_reply_at        TIMESTAMPTZ,
  post_commented        BOOLEAN NOT NULL DEFAULT FALSE,
  post_commented_at     TIMESTAMPTZ,
  warmup_complete       BOOLEAN NOT NULL DEFAULT FALSE,

  notes                 TEXT,
  rejection_reason      TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the most common dashboard queries
CREATE INDEX idx_prospects_status       ON prospects (status);
CREATE INDEX idx_prospects_score        ON prospects (score DESC) WHERE score IS NOT NULL;
CREATE INDEX idx_prospects_handle       ON prospects (handle);
CREATE INDEX idx_prospects_discovered   ON prospects (discovered_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- PROSPECT CONTENT TABLE
-- AI-generated copy for each lead. One row per prospect.
-- ============================================================

CREATE TABLE prospect_content (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id           UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,

  -- DM variants (3 generated by analyst, user picks one)
  dm_variant_1          TEXT,
  dm_variant_1_style    VARCHAR(20),    -- e.g. A1, A2, A4, B1, B2, B4, B5, bio_fallback
  dm_variant_2          TEXT,
  dm_variant_2_style    VARCHAR(20),
  dm_variant_3          TEXT,
  dm_variant_3_style    VARCHAR(20),

  -- The DM actually selected and sent
  primary_dm            TEXT,           -- Populated when user picks a variant
  primary_dm_style      VARCHAR(20),

  -- Warmup copy (Category 1)
  story_reply           TEXT,
  post_comment          TEXT,

  -- Follow-up (Category 3 — sent day 5-7 only)
  follow_up_dm          TEXT,
  follow_up_style       VARCHAR(20),    -- "easy_question" | "fresh_observation"

  -- AI generation metadata
  generated_at          TIMESTAMPTZ,
  model_used            VARCHAR(100) DEFAULT 'claude-sonnet-4-5',
  generation_notes      TEXT,          -- analyst reasoning / specific content reference used

  -- Send tracking
  sent_at               TIMESTAMPTZ,
  sent_text             TEXT,          -- Exact text sent (may differ if user edited)
  follow_up_sent_at     TIMESTAMPTZ,
  follow_up_sent_text   TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (prospect_id)                 -- One content row per prospect
);

CREATE INDEX idx_content_prospect ON prospect_content (prospect_id);

CREATE TRIGGER content_updated_at
  BEFORE UPDATE ON prospect_content
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- SYSTEM MEMORY TABLES (Replaces the .json memory files)
-- ============================================================

-- Scout daily memory (replaces scout-memory.json)
CREATE TABLE scout_memory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                  DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  daily_discovery_count INTEGER NOT NULL DEFAULT 0,
  strategy_index        INTEGER NOT NULL DEFAULT 0,  -- 0-4, cycles through 5 strategies
  strategies_used_today JSONB NOT NULL DEFAULT '[]'::jsonb,
  discovered_handles    JSONB NOT NULL DEFAULT '[]'::jsonb, -- dedup guard
  refused_runs          INTEGER NOT NULL DEFAULT 0,
  last_run              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER scout_memory_updated_at
  BEFORE UPDATE ON scout_memory
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Radar daily memory (replaces radar-memory.json)
CREATE TABLE radar_memory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                  DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  runs_today            INTEGER NOT NULL DEFAULT 0,
  daily_dm_count        INTEGER NOT NULL DEFAULT 0,
  last_action           VARCHAR(100),   -- scout | analyst | connect_prompt | skip | none
  last_run              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER radar_memory_updated_at
  BEFORE UPDATE ON radar_memory
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Analyst daily memory (replaces analyst-memory.json)
CREATE TABLE analyst_memory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                  DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  profiles_enriched_today INTEGER NOT NULL DEFAULT 0,
  profiles_scored_today   INTEGER NOT NULL DEFAULT 0,
  dms_generated_today     INTEGER NOT NULL DEFAULT 0,
  last_run              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER analyst_memory_updated_at
  BEFORE UPDATE ON analyst_memory
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Activity log (replaces the *-log.txt files with queryable rows)
CREATE TABLE activity_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                VARCHAR(50) NOT NULL,   -- radar | scout | analyst | connect | system
  action                VARCHAR(100) NOT NULL,
  detail                TEXT,
  prospect_id           UUID REFERENCES prospects(id) ON DELETE SET NULL,
  metadata              JSONB DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_log_source      ON activity_log (source);
CREATE INDEX idx_log_created     ON activity_log (created_at DESC);
CREATE INDEX idx_log_prospect    ON activity_log (prospect_id) WHERE prospect_id IS NOT NULL;

-- ============================================================
-- CONVENIENCE VIEWS
-- ============================================================

-- Ready queue: prospects at status=ready with their content
CREATE VIEW v_ready_queue AS
SELECT
  p.*,
  pc.dm_variant_1,
  pc.dm_variant_1_style,
  pc.dm_variant_2,
  pc.dm_variant_2_style,
  pc.dm_variant_3,
  pc.dm_variant_3_style,
  pc.story_reply,
  pc.post_comment,
  pc.generated_at AS content_generated_at
FROM prospects p
LEFT JOIN prospect_content pc ON pc.prospect_id = p.id
WHERE p.status = 'ready'
ORDER BY p.score DESC, p.discovered_at ASC;

-- Follow-up queue: messaged 7+ days ago, no follow-up sent
CREATE VIEW v_followup_queue AS
SELECT
  p.*,
  pc.follow_up_dm,
  pc.sent_at AS dm_sent_at,
  pc.follow_up_sent_at,
  NOW() - pc.sent_at AS days_since_dm
FROM prospects p
JOIN prospect_content pc ON pc.prospect_id = p.id
WHERE
  p.status = 'messaged'
  AND pc.sent_at IS NOT NULL
  AND pc.sent_at < NOW() - INTERVAL '7 days'
  AND pc.follow_up_sent_at IS NULL
  AND pc.follow_up_dm IS NOT NULL
ORDER BY pc.sent_at ASC;

-- Pipeline health snapshot (used by Radar)
CREATE VIEW v_pipeline_health AS
SELECT
  COUNT(*) FILTER (WHERE status = 'discovered') AS discovered,
  COUNT(*) FILTER (WHERE status = 'enriched')   AS enriched,
  COUNT(*) FILTER (WHERE status = 'scored')     AS scored,
  COUNT(*) FILTER (WHERE status = 'ready')      AS ready,
  COUNT(*) FILTER (WHERE status = 'messaged')   AS messaged,
  COUNT(*) FILTER (WHERE status = 'skipped')    AS skipped,
  COUNT(*) FILTER (WHERE status = 'rejected')   AS rejected,
  COUNT(*) AS total
FROM prospects;

-- ============================================================
-- SEED: Initialize today's memory rows
-- ============================================================
INSERT INTO scout_memory (date) VALUES (CURRENT_DATE) ON CONFLICT (date) DO NOTHING;
INSERT INTO radar_memory (date) VALUES (CURRENT_DATE) ON CONFLICT (date) DO NOTHING;
INSERT INTO analyst_memory (date) VALUES (CURRENT_DATE) ON CONFLICT (date) DO NOTHING;
