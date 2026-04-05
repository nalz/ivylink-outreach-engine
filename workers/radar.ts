// ============================================================
// workers/radar.ts — IvyLink Outreach Radar (Railway Cron)
// ============================================================
// Entry point for the hourly Railway cron job.
// Reads pipeline state, decides what to do next, delegates.
//
// Deploy on Railway as a cron service:
//   Command: node -r ts-node/register workers/radar.ts
//   Schedule: 0 * * * *  (every hour, 7am-11pm)
// ============================================================

import { Pool } from 'pg';
import { runScout } from './scout';
import { runAnalyst } from './analyst';

// ── Config ────────────────────────────────────────────────────────────────────

const DAILY_DM_LIMIT = 8;
const READY_QUEUE_LOW_THRESHOLD = 3;  // Trigger analyst if ready < this
const DISCOVERED_BACKLOG_THRESHOLD = 5; // Trigger scout if discovered < this
const ACTIVE_HOURS = { start: 7, end: 23 }; // 7am to 11pm local

// ── DB pool ───────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type RadarAction =
  | 'scout'
  | 'analyst'
  | 'connect_prompt'
  | 'random_skip'
  | 'after_hours'
  | 'daily_dm_limit'
  | 'idle';

interface PipelineSnapshot {
  discovered: number;
  enriched: number;
  scored: number;
  ready: number;
  messaged: number;
  skipped: number;
  rejected: number;
  total: number;
}

// ── Main radar function ───────────────────────────────────────────────────────

async function runRadar(): Promise<void> {
  const runStart = new Date();
  const today = runStart.toISOString().split('T')[0];
  const hour = runStart.getHours();

  console.log(`\n[radar] Starting run at ${runStart.toISOString()}`);

  // ── Step 1: After-hours check ─────────────────────────────────────────────
  if (hour < ACTIVE_HOURS.start || hour >= ACTIVE_HOURS.end) {
    await logAndExit('after_hours', 'Outside active hours (7am-11pm)');
    return;
  }

  // ── Step 2: Random human-behavior skip (20% of runs) ─────────────────────
  const randomRoll = Math.ceil(Math.random() * 10);
  if (randomRoll <= 2) {
    await logAndExit('random_skip', `Random skip (rolled ${randomRoll}/10)`);
    return;
  }

  // ── Step 3: Load today's memory ──────────────────────────────────────────
  const { rows: [radarMem] } = await pool.query<{
    runs_today: number;
    daily_dm_count: number;
    last_action: string | null;
    last_run: string | null;
  }>(`
    INSERT INTO radar_memory (date) VALUES ($1)
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `, [today]);

  // ── Step 4: Load pipeline health snapshot ────────────────────────────────
  const { rows: [health] } = await pool.query<PipelineSnapshot>(
    `SELECT * FROM v_pipeline_health`
  );

  const { rows: [scoutMem] } = await pool.query<{
    daily_discovery_count: number;
    last_run: string | null;
  }>(`
    INSERT INTO scout_memory (date) VALUES ($1)
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `, [today]);

  console.log(`[radar] Pipeline: discovered=${health.discovered} enriched=${health.enriched} scored=${health.scored} ready=${health.ready} messaged=${health.messaged}`);
  console.log(`[radar] Today: DMs sent=${radarMem.daily_dm_count} scout_finds=${scoutMem.daily_discovery_count}`);

  // ── Step 5: DM limit hard stop ───────────────────────────────────────────
  if (radarMem.daily_dm_count >= DAILY_DM_LIMIT) {
    await logAndExit('daily_dm_limit', `Daily DM limit reached (${radarMem.daily_dm_count}/${DAILY_DM_LIMIT})`);
    return;
  }

  // ── Step 6: Decide action (priority order) ───────────────────────────────
  // Priority: analyst > connect_prompt > scout

  let action: RadarAction = 'idle';
  let actionDetail = '';

  // Analyst takes priority: process backlog first
  const needsAnalyst =
    health.enriched > 0 ||
    health.discovered > 0 ||
    health.scored > 0;

  if (needsAnalyst && health.ready < READY_QUEUE_LOW_THRESHOLD) {
    action = 'analyst';
    actionDetail = `Backlog: discovered=${health.discovered} enriched=${health.enriched} scored=${health.scored}, ready queue low (${health.ready})`;
  }
  // Connect prompt: ready queue has leads and we're under DM limit
  else if (health.ready >= 1) {
    action = 'connect_prompt';
    actionDetail = `${health.ready} prospect(s) ready to message`;
  }
  // Scout: pipeline needs more discovered prospects
  else if (health.discovered < DISCOVERED_BACKLOG_THRESHOLD &&
           scoutMem.daily_discovery_count < 20) {
    action = 'scout';
    actionDetail = `Discovered backlog low (${health.discovered}), daily count: ${scoutMem.daily_discovery_count}`;
  }
  // Idle: everything balanced
  else {
    action = 'idle';
    actionDetail = `Pipeline balanced. Scout finds today: ${scoutMem.daily_discovery_count}`;
  }

  console.log(`[radar] Decision: ${action} — ${actionDetail}`);

  // ── Step 7: Execute decision ─────────────────────────────────────────────

  if (action === 'analyst') {
    const stats = await runAnalyst(pool);
    actionDetail = `Analyst ran: scored=${stats.scored} dms=${stats.dmsGenerated} rejected=${stats.rejected} errors=${stats.errors}`;
  }

  else if (action === 'scout') {
    const result = await runScout(pool);
    if (result.refusalReason) {
      action = 'idle';
      actionDetail = `Scout refused: ${result.refusalReason}`;
    } else {
      actionDetail = `Scout found ${result.found} new prospects`;
    }
  }

  else if (action === 'connect_prompt') {
    // Surface ready leads — dashboard handles the actual copy/paste
    const { rows: ready } = await pool.query<{
      handle: string;
      score: number;
      score_reasoning: string;
    }>(`
      SELECT handle, score, score_reasoning
      FROM v_ready_queue
      LIMIT 5
    `);

    const readyList = ready
      .map((r) => `  - @${r.handle} (score: ${r.score}) — ${r.score_reasoning}`)
      .join('\n');

    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║  OUTREACH RADAR: ${ready.length} prospect(s) ready to message`);
    console.log(`╚══════════════════════════════════════════════╝`);
    console.log(`Ready queue:\n${readyList}`);
    console.log(`\nOpen the Action Center dashboard to copy-paste and send.`);
    console.log(`→ Dashboard: ${process.env.DASHBOARD_URL ?? 'https://your-app.railway.app/outreach'}\n`);
  }

  // ── Step 8: Update radar memory ─────────────────────────────────────────
  await pool.query(`
    UPDATE radar_memory SET
      runs_today = runs_today + 1,
      last_action = $1,
      last_run = NOW(),
      updated_at = NOW()
    WHERE date = $2
  `, [action, today]);

  // Final log entry
  const logLine = `[${runStart.toISOString()}] radar: ${action} | discovered=${health.discovered} enriched=${health.enriched} ready=${health.ready} messaged=${health.messaged} | ${actionDetail}`;

  await pool.query(`
    INSERT INTO activity_log (source, action, detail, metadata)
    VALUES ('radar', $1, $2, $3::jsonb)
  `, [
    action,
    actionDetail,
    JSON.stringify({ health, runs_today: radarMem.runs_today + 1 }),
  ]);

  console.log(`[radar] Done: ${logLine}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logAndExit(action: RadarAction, reason: string): Promise<void> {
  console.log(`[radar] Exiting: ${reason}`);
  const today = new Date().toISOString().split('T')[0];

  await pool.query(`
    INSERT INTO radar_memory (date) VALUES ($1)
    ON CONFLICT (date) DO UPDATE SET
      runs_today = radar_memory.runs_today + 1,
      last_action = $2,
      last_run = NOW(),
      updated_at = NOW()
  `, [today, action]);

  await pool.query(`
    INSERT INTO activity_log (source, action, detail)
    VALUES ('radar', $1, $2)
  `, [action, reason]);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

runRadar()
  .then(() => {
    console.log('[radar] Run complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[radar] Fatal error:', err);
    process.exit(1);
  });
