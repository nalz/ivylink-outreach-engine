-- ============================================================
-- Migration: Add collab_track column for Track A/B classification
-- Run once in Neon SQL editor
-- ============================================================

-- collab_track stored in notes as JSON — no schema change needed for MVP.
-- But if you want a proper indexed column, run this:

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS collab_track CHAR(1) CHECK (collab_track IN ('A', 'B'));

-- Backfill from notes field (for existing records)
UPDATE prospects
SET collab_track = (notes::jsonb->>'track')
WHERE notes IS NOT NULL
  AND notes::text LIKE '%"track"%'
  AND collab_track IS NULL;

-- Optional index for filtering by track
CREATE INDEX IF NOT EXISTS idx_prospects_track ON prospects (collab_track) WHERE collab_track IS NOT NULL;
