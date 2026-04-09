// ============================================================
// workers/radar.ts — IvyLink Outreach Radar (Railway Cron)
// ============================================================
// Entry point for the hourly Railway cron job.
// When scouting, cycles through medspa → salon → fitness
// on successive runs so all three verticals stay fresh.
// ============================================================

import { Pool } from 'pg';
import { runScout, type IcpCategory } from './scout';
import { runAnalyst } from './analyst';

const DAILY_DM_LIMIT = 8;
const READY_QUEUE_LOW_THRESHOLD = 3;
const DISCOVERED_BACKLOG_THRESHOLD = 5;
const ACTIVE_HOURS = { start: 7, end: 23 };

// Category rotation order for scout runs
const SCOUT_CATEGORIES: IcpCategory[] = ['medspa', 'salon', 'fitness'];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

type RadarAction =
  | 'scout'
  | 'analyst'
  | 'connect_prompt'
  | 'random_skip'
  | 'after_hours'
  | 'daily_dm_limit'
  | 'idle';

interface PipelineSnapshot {
  discovered: number; enriched: number; scored: number; ready: number;
  messaged: number; skipped: number; rejected: number; total: number;
}

async function runRadar(): Promise<void> {
  const runStart = new Date();
  const today = runStart.toISOString().split('T')[0];
  const hour = runStart.getHours();

  console.log(`\n[radar] Starting run at ${runStart.toISOString()}`);

  if (hour < ACTIVE_HOURS.start || hour >= ACTIVE_HOURS.end) {
    await logAndExit('after_hours', 'Outside active hours (7am-11pm)');
    return;
  }

  const randomRoll = Math.ceil(Math.random() * 10);
  if (randomRoll <= 2) {
    await logAndExit('random_skip', `Random skip (rolled ${randomRoll}/10)`);
    return;
  }

  const { rows: [radarMem] } = await pool.query<{
    runs_today: number; daily_dm_count: number;
    last_action: string | null; last_run: string | null;
  }>(`
    INSERT INTO radar_memory (date) VALUES ($1)
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `, [today]);

  const { rows: [health] } = await pool.query<PipelineSnapshot>(
    `SELECT * FROM v_pipeline_health`
  );

  const { rows: [scoutMem] } = await pool.query<{
    daily_discovery_count: number; strategy_index: number; last_run: string | null;
  }>(`
    INSERT INTO scout_memory (date) VALUES ($1)
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `, [today]);

  console.log(`[radar] Pipeline: discovered=${health.discovered} enriched=${health.enriched} scored=${health.scored} ready=${health.ready} messaged=${health.messaged}`);

  if (radarMem.daily_dm_count >= DAILY_DM_LIMIT) {
    await logAndExit('daily_dm_limit', `Daily DM limit reached (${radarMem.daily_dm_count}/${DAILY_DM_LIMIT})`);
    return;
  }

  let action: RadarAction = 'idle';
  let actionDetail = '';

  const needsAnalyst = health.enriched > 0 || health.discovered > 0 || health.scored > 0;

  if (needsAnalyst && health.ready < READY_QUEUE_LOW_THRESHOLD) {
    action = 'analyst';
    actionDetail = `Backlog: discovered=${health.discovered} enriched=${health.enriched} scored=${health.scored}`;
  } else if (health.ready >= 1) {
    action = 'connect_prompt';
    actionDetail = `${health.ready} prospect(s) ready to message`;
  } else if (health.discovered < DISCOVERED_BACKLOG_THRESHOLD) {
    action = 'scout';
    actionDetail = `Discovered backlog low (${health.discovered})`;
  } else {
    action = 'idle';
    actionDetail = `Pipeline balanced`;
  }

  console.log(`[radar] Decision: ${action} — ${actionDetail}`);

  if (action === 'analyst') {
    const stats = await runAnalyst(pool);
    actionDetail = `Analyst ran: scored=${stats.scored} dms=${stats.dmsGenerated} errors=${stats.errors}`;
  }

  else if (action === 'scout') {
    // Cycle through categories using strategy_index so each run covers a different vertical
    const categoryIndex = (scoutMem.strategy_index ?? 0) % SCOUT_CATEGORIES.length;
    const category = SCOUT_CATEGORIES[categoryIndex];
    console.log(`[radar] Scout category: ${category} (index ${categoryIndex})`);

    const result = await runScout(pool, undefined, category);
    if (result.refusalReason) {
      action = 'idle';
      actionDetail = `Scout refused: ${result.refusalReason}`;
    } else {
      actionDetail = `Scout [${category}] found ${result.found} new prospects`;
    }
  }

  else if (action === 'connect_prompt') {
    const { rows: ready } = await pool.query<{
      handle: string; score: number; score_reasoning: string;
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
    console.log(`\nOpen the dashboard to send.`);
    console.log(`→ Dashboard: ${process.env.DASHBOARD_URL ?? 'https://your-app.railway.app/outreach'}\n`);
  }

  await pool.query(`
    UPDATE radar_memory SET
      runs_today = runs_today + 1,
      last_action = $1,
      last_run = NOW(),
      updated_at = NOW()
    WHERE date = $2
  `, [action, today]);

  await pool.query(`
    INSERT INTO activity_log (source, action, detail, metadata)
    VALUES ('radar', $1, $2, $3::jsonb)
  `, [
    action, actionDetail,
    JSON.stringify({ health, runs_today: radarMem.runs_today + 1 }),
  ]);

  console.log(`[radar] Done: ${action} | ${actionDetail}`);
}

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

runRadar()
  .then(() => { console.log('[radar] Run complete.'); process.exit(0); })
  .catch((err) => { console.error('[radar] Fatal error:', err); process.exit(1); });
