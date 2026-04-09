// ============================================================
// src/app/api/outreach/trigger/route.ts
// POST /api/outreach/trigger?job=radar|analyst|scout[&category=medspa|salon|fitness]
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getSessionFromRequest } from '@/lib/auth';
import type { IcpCategory } from '@/../workers/scout';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
});

export async function POST(req: NextRequest) {
  const authenticated = await getSessionFromRequest(req);
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = req.nextUrl.searchParams.get('job') ?? 'radar';

  // Category for scout — defaults to medspa if not provided or invalid
  const categoryParam = req.nextUrl.searchParams.get('category');
  const category: IcpCategory =
    categoryParam === 'salon' || categoryParam === 'fitness'
      ? categoryParam
      : 'medspa';

  if (!['radar', 'analyst', 'scout'].includes(job)) {
    return NextResponse.json(
      { error: 'Invalid job. Use: radar | analyst | scout' },
      { status: 400 }
    );
  }

  try {
    let result: Record<string, unknown> = {};

    if (job === 'scout') {
      const { runScout } = await import('@/../workers/scout');
      result = await runScout(pool, undefined, category);
    }

    if (job === 'analyst') {
      const { runAnalyst } = await import('@/../workers/analyst');
      result = await runAnalyst(pool);
    }

    if (job === 'radar') {
      const { runAnalyst } = await import('@/../workers/analyst');
      const { runScout }   = await import('@/../workers/scout');

      const today = new Date().toISOString().split('T')[0];

      const healthRes = await pool.query(`SELECT * FROM v_pipeline_health`);
      const h = healthRes.rows[0];

      const scoutMemRes = await pool.query(
        `INSERT INTO scout_memory (date) VALUES ($1)
         ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date RETURNING *`,
        [today]
      );
      const sm = scoutMemRes.rows[0];

      let action = 'idle';
      let detail = '';
      let analystStats = null;
      let scoutStats   = null;

      const needsAnalyst = h.enriched > 0 || h.discovered > 0;

      if (needsAnalyst && h.ready < 3) {
        action = 'analyst';
        analystStats = await runAnalyst(pool);
        detail = `scored=${analystStats.scored} dms=${analystStats.dmsGenerated} rejected=${analystStats.rejected}`;
      } else if (h.ready >= 1) {
        action = 'connect_prompt';
        detail = `${h.ready} prospect(s) ready in dashboard`;
      } else if (h.discovered < 5) {
        action = 'scout';
        // Radar uses medspa by default; manual trigger can specify category
        scoutStats = await runScout(pool, undefined, category);
        detail = scoutStats.refusalReason
          ? `refused: ${scoutStats.refusalReason}`
          : `found=${scoutStats.found}`;
      } else {
        detail = 'pipeline balanced';
      }

      await pool.query(
        `INSERT INTO radar_memory (date, runs_today, last_action, last_run)
         VALUES ($1, 1, $2, NOW())
         ON CONFLICT (date) DO UPDATE SET
           runs_today = radar_memory.runs_today + 1,
           last_action = $2,
           last_run = NOW(),
           updated_at = NOW()`,
        [today, action]
      );

      result = { action, detail, health: h, analystStats, scoutStats };
    }

    return NextResponse.json({ ok: true, job, result });

  } catch (err) {
    console.error(`[trigger/${job}]`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
