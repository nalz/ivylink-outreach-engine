// ============================================================
// workers/scout.ts — IvyLink Outreach Scout
// ============================================================
// Triggers Apify Instagram scraper to discover new prospects.
// Enforces 25-minute gap and daily limits.
// ============================================================

import { Pool } from 'pg';

const APIFY_TOKEN = process.env.APIFY_TOKEN!;
// Correct format: creator~actor-name (tilde, not slash)
const APIFY_ACTOR_ID = 'apify~instagram-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

// Max prospects to add per scout run — keeping it low to mimic human pacing
const MAX_PROSPECTS_PER_RUN = 5;
// Max handles to fetch full profiles for in Phase 2
const MAX_PROFILE_LOOKUPS = 25;
const DAILY_DISCOVERY_LIMIT = 30;
const MIN_GAP_MINUTES = 25;

// ── Discovery strategies ───────────────────────────────────────────────────────

// Seed accounts: known NJ med spas whose followers/following lists
// contain other med spa owners. Much higher signal than hashtags.
const SEED_ACCOUNTS = [
  'hlmedspa.official',
  'time2dripmedspa',
  'thegardenmedspanj',
  'luminarymedspa',
  'glowbarmedspa',
  'njskinclinic',
  'aestheticsbydesignnj',
  'njlasercenter',
] as const;

// Hashtag strategies as fallback — lower signal, cast wider net
const HASHTAG_STRATEGIES = [
  ['#newjerseymedspa', '#njmedspa'],
  ['#medspabusiness', '#medspagrowth', '#medspamarketing'],
  ['#injectables', '#botox', '#hydrafacial'],
  ['#hobokenmedspa', '#jerseycitymedspa', '#montclairmedspa', '#summitmedspa'],
  ['#medspa', '#aestheticbusiness', '#aestheticsbusiness'],
] as const;

const STRATEGY_NAMES = [
  'seed_followers',     // Scan following lists of known NJ med spas
  'hashtag_local_nj',
  'hashtag_business',
  'hashtag_service',
  'hashtag_city',
  'hashtag_volume',
] as const;

// ── ICP qualification criteria ────────────────────────────────────────────────

function isQualifiedProspect(account: {
  username: string;
  biography: string;
  followersCount: number;
  followsCount: number;
  isPrivate: boolean;
  postsCount: number;
}): boolean {
  if (account.isPrivate) return false;

  // Wider follower range — some owner accounts are smaller or larger
  if (account.followersCount < 100 || account.followersCount > 100_000) return false;

  const bio = (account.biography ?? '').toLowerCase();

  // Expanded keyword list — catches alternate spellings and adjacent niches
  const icpKeywords = [
    'med spa', 'medspa', 'medical spa',
    'aesthetics', 'esthetics', 'aesthetic',
    'injectables', 'injector', 'botox', 'filler',
    'skincare', 'skin care', 'facial',
    'wellness', 'body contouring',
    'hydrafacial', 'microneedling', 'laser',
    'anti-aging', 'anti aging',
    'lash', 'brow', 'waxing',                 // adjacent beauty services
    'iv therapy', 'iv drip', 'hormone',        // wellness/med adjacent
    'clinic', 'spa owner', 'beauty studio',
  ];

  const hasIcpBio = icpKeywords.some((kw) => bio.includes(kw));
  if (!hasIcpBio) return false;

  return true;
}

// ── Apify: Step 1a — get handles from seed account following lists ────────────
// Following lists of known med spas contain other med spa owners.
// Much higher signal than hashtag posts.

async function getHandlesFromSeedAccounts(seeds: readonly string[]): Promise<string[]> {
  // Use profile details to get following list signals
  // We scrape the seed profiles' following as directUrls
  const directUrls = seeds.map((s) => `https://www.instagram.com/${s}/`);

  const runRes = await fetch(
    `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls,
        resultsType: 'details',
        resultsLimit: 1,
      }),
    }
  );

  if (!runRes.ok) {
    const text = await runRes.text();
    throw new Error(`Apify seed run failed: ${runRes.status} ${text}`);
  }

  const runData = await runRes.json() as { data: { id: string } };
  const items = await pollApifyRun(runData.data.id, 90);

  // Extract latestPosts authors and tagged users from seed profiles
  // as proxies for their network — accounts that interact with known med spas
  const handles = new Set<string>();
  for (const item of items) {
    const profile = item as {
      username?: string;
      latestPosts?: Array<{
        ownerUsername?: string;
        taggedUsers?: Array<{ username?: string }>;
        coauthorProducers?: Array<{ username?: string }>;
      }>;
    };

    // Accounts tagged in the seed's posts are strong ICP signals
    for (const post of profile.latestPosts ?? []) {
      for (const tagged of post.taggedUsers ?? []) {
        if (tagged.username) handles.add(tagged.username);
      }
      for (const coauthor of post.coauthorProducers ?? []) {
        if (coauthor.username) handles.add(coauthor.username);
      }
    }
  }

  console.log(`[scout] Seed strategy: found ${handles.size} handles from ${seeds.length} seed accounts`);
  return [...handles];
}

async function getHandlesFromHashtags(hashtags: string[]): Promise<string[]> {
  const directUrls = hashtags.map(
    (h) => `https://www.instagram.com/explore/tags/${h.replace('#', '')}/`
  );

  const runRes = await fetch(
    `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls,
        resultsType: 'posts',
        resultsLimit: 30, // cast wide — we'll filter after profile lookup
      }),
    }
  );

  if (!runRes.ok) {
    const text = await runRes.text();
    throw new Error(`Apify hashtag run failed: ${runRes.status} ${text}`);
  }

  const runData = await runRes.json() as { data: { id: string } };
  const items = await pollApifyRun(runData.data.id, 90);

  // Extract unique owner handles from post items
  const handles = new Set<string>();
  for (const item of items) {
    const post = item as { ownerUsername?: string };
    if (post.ownerUsername) handles.add(post.ownerUsername);
  }

  console.log(`[scout] Step 1: found ${handles.size} unique handles from ${items.length} posts`);
  return [...handles];
}

// ── Apify: Step 2 — fetch full profile data for a list of handles ─────────────

async function getProfilesForHandles(handles: string[]): Promise<Array<{
  username: string;
  fullName: string;
  biography: string;
  followersCount: number;
  followsCount: number;
  postsCount: number;
  isPrivate: boolean;
}>> {
  const directUrls = handles.map(
    (h) => `https://www.instagram.com/${h}/`
  );

  const runRes = await fetch(
    `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls,
        resultsType: 'details', // profile-level data including bio + follower count
        resultsLimit: 1,        // 1 result per profile URL
      }),
    }
  );

  if (!runRes.ok) {
    const text = await runRes.text();
    throw new Error(`Apify profile run failed: ${runRes.status} ${text}`);
  }

  const runData = await runRes.json() as { data: { id: string } };
  const items = await pollApifyRun(runData.data.id, 120);

  return items.map((item) => {
    const p = item as {
      username?: string;
      fullName?: string;
      biography?: string;
      followersCount?: number;
      followsCount?: number;
      postsCount?: number;
      isPrivate?: boolean;
    };
    return {
      username: p.username ?? '',
      fullName: p.fullName ?? '',
      biography: p.biography ?? '',
      followersCount: p.followersCount ?? 0,
      followsCount: p.followsCount ?? 0,
      postsCount: p.postsCount ?? 0,
      isPrivate: p.isPrivate ?? false,
    };
  }).filter((p) => p.username !== '');
}

// ── Shared poll helper ────────────────────────────────────────────────────────

async function pollApifyRun(runId: string, timeoutSecs: number): Promise<unknown[]> {
  const maxPolls = Math.floor(timeoutSecs / 5);

  for (let i = 0; i < maxPolls; i++) {
    await sleep(5000);

    const statusRes = await fetch(
      `${APIFY_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`
    );
    const statusData = await statusRes.json() as {
      data: { status: string; defaultDatasetId: string }
    };
    const { status, defaultDatasetId } = statusData.data;

    if (status === 'SUCCEEDED') {
      const dataRes = await fetch(
        `${APIFY_BASE}/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=100`
      );
      const items = await dataRes.json() as unknown[];
      return Array.isArray(items) ? items : [];
    }

    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${runId} ended with status: ${status}`);
    }
  }

  throw new Error(`Apify run ${runId} timed out after ${timeoutSecs}s`);
}


// ── Main scout function ───────────────────────────────────────────────────────

export async function runScout(pool: Pool): Promise<{
  found: number;
  skipped: number;
  refusalReason?: string;
}> {
  const today = new Date().toISOString().split('T')[0];

  // Load or create today's scout memory
  const { rows: [memory] } = await pool.query<{
    id: string;
    daily_discovery_count: number;
    strategy_index: number;
    strategies_used_today: string[];
    discovered_handles: string[];
    last_run: string | null;
  }>(`
    INSERT INTO scout_memory (date) VALUES ($1)
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING *
  `, [today]);

  // Safety check: 25-minute gap
  if (memory.last_run) {
    const gapMs = Date.now() - new Date(memory.last_run).getTime();
    const gapMin = gapMs / 1000 / 60;
    if (gapMin < MIN_GAP_MINUTES) {
      const reason = `Gap check failed: last run ${Math.round(gapMin)}m ago (min ${MIN_GAP_MINUTES}m)`;
      console.log(`[scout] Refused: ${reason}`);
      await pool.query(
        `UPDATE scout_memory SET refused_runs = refused_runs + 1, updated_at = NOW() WHERE date = $1`,
        [today]
      );
      return { found: 0, skipped: 0, refusalReason: reason };
    }
  }

  // Safety check: daily limit
  if (memory.daily_discovery_count >= DAILY_DISCOVERY_LIMIT) {
    const reason = `Daily limit reached (${memory.daily_discovery_count}/${DAILY_DISCOVERY_LIMIT})`;
    console.log(`[scout] Refused: ${reason}`);
    return { found: 0, skipped: 0, refusalReason: reason };
  }

  // Pick strategy — seed_followers is index 0, hashtags are 1-5
  const strategyIndex = memory.strategy_index % STRATEGY_NAMES.length;
  const strategyName = STRATEGY_NAMES[strategyIndex];
  const isSeedStrategy = strategyName === 'seed_followers';
  // Hashtag strategies start at index 1, so offset by 1
  const hashtagIndex = Math.max(0, strategyIndex - 1) % HASHTAG_STRATEGIES.length;
  const hashtags = isSeedStrategy ? [] : [...HASHTAG_STRATEGIES[hashtagIndex]];

  console.log(`[scout] Running strategy: ${strategyName}${!isSeedStrategy ? ` with ${hashtags.join(', ')}` : ''}`);

  // Get known handles to avoid duplicates
  const { rows: knownRows } = await pool.query<{ handle: string }>(
    `SELECT handle FROM prospects`
  );
  const knownHandles = new Set([
    ...knownRows.map((r) => r.handle),
    ...(memory.discovered_handles as string[]),
  ]);

  // Mark this run immediately (before Apify) so gap check works
  await pool.query(`
    UPDATE scout_memory SET last_run = NOW(), updated_at = NOW() WHERE date = $1
  `, [today]);

  // Phase 1: get unique handles from seed accounts or hashtag posts
  let rawHandles: string[] = [];
  try {
    if (isSeedStrategy) {
      rawHandles = await getHandlesFromSeedAccounts(SEED_ACCOUNTS);
    } else {
      rawHandles = await getHandlesFromHashtags(hashtags);
    }
  } catch (err) {
    console.error('[scout] Phase 1 error:', err);
    await pool.query(`
      INSERT INTO activity_log (source, action, detail)
      VALUES ('scout', 'apify_error', $1)
    `, [err instanceof Error ? err.message : String(err)]);
    return { found: 0, skipped: 0, refusalReason: `Apify error: ${err}` };
  }

  // Filter out already-known handles before doing profile lookups
  const newHandles = rawHandles.filter((h) => !knownHandles.has(h)).slice(0, MAX_PROFILE_LOOKUPS);

  if (newHandles.length === 0) {
    console.log('[scout] All handles already known, nothing to enrich');
    return { found: 0, skipped: rawHandles.length };
  }

  console.log(`[scout] Step 2: fetching profiles for ${newHandles.length} new handles`);

  // Phase 2: fetch full profile data for new handles
  let profiles: Awaited<ReturnType<typeof getProfilesForHandles>> = [];
  try {
    profiles = await getProfilesForHandles(newHandles);
    console.log(`[scout] Step 2: got ${profiles.length} profiles`);
    if (profiles.length > 0) {
      console.log(`[scout] Sample profile: ${JSON.stringify(profiles[0]).slice(0, 300)}`);
    }
  } catch (err) {
    console.error('[scout] Phase 2 (profile) error:', err);
    await pool.query(`
      INSERT INTO activity_log (source, action, detail)
      VALUES ('scout', 'apify_error', $1)
    `, [`Phase 2: ${err instanceof Error ? err.message : String(err)}`]);
    return { found: 0, skipped: 0, refusalReason: `Apify profile error: ${err}` };
  }

  // Qualify profiles against ICP criteria
  const seen = new Set<string>();
  const candidates: Array<{
    handle: string;
    name: string;
    bio: string;
    follower_count: number;
    following_count: number;
    post_count: number;
  }> = [];

  for (const profile of profiles) {
    if (seen.has(profile.username) || knownHandles.has(profile.username)) continue;
    seen.add(profile.username);

    if (isQualifiedProspect({
      username: profile.username,
      biography: profile.biography,
      followersCount: profile.followersCount,
      followsCount: profile.followsCount,
      isPrivate: profile.isPrivate,
      postsCount: profile.postsCount,
    })) {
      candidates.push({
        handle: profile.username,
        name: profile.fullName,
        bio: profile.biography,
        follower_count: profile.followersCount,
        following_count: profile.followsCount,
        post_count: profile.postsCount,
      });

      if (candidates.length >= MAX_PROSPECTS_PER_RUN) break;
    }
  }

  // Insert qualified prospects
  let inserted = 0;
  const insertedHandlesList: string[] = [];

  for (const c of candidates) {
    const { rowCount } = await pool.query(`
      INSERT INTO prospects (handle, name, bio, follower_count, following_count,
                             post_count, discovered_via, source_detail)
      VALUES ($1, $2, $3, $4, $5, $6, 'hashtag', $7)
      ON CONFLICT (handle) DO NOTHING
    `, [c.handle, c.name, c.bio, c.follower_count, c.following_count,
       c.post_count, hashtags.join(', ')]);

    if (rowCount && rowCount > 0) {
      inserted++;
      insertedHandlesList.push(c.handle);

      await pool.query(`
        INSERT INTO activity_log (source, action, detail)
        VALUES ('scout', 'discovered', $1)
      `, [`@${c.handle} via ${strategyName}`]);

      console.log(`[scout] Added @${c.handle} (${c.follower_count} followers)`);
    }
  }

  // Update memory
  const updatedHandles = [
    ...(memory.discovered_handles as string[]),
    ...insertedHandlesList,
  ];

  await pool.query(`
    UPDATE scout_memory SET
      daily_discovery_count = daily_discovery_count + $1,
      strategy_index = $2,
      strategies_used_today = strategies_used_today || $3::jsonb,
      discovered_handles = $4::jsonb,
      updated_at = NOW()
    WHERE date = $5
  `, [
    inserted,
    strategyIndex + 1,
    JSON.stringify([strategyName]),
    JSON.stringify(updatedHandles),
    today,
  ]);

  const logMsg = `[${new Date().toISOString()}] scout: found ${inserted} prospects via ${strategyName} | daily total: ${memory.daily_discovery_count + inserted}`;
  console.log(logMsg);

  await pool.query(`
    INSERT INTO activity_log (source, action, detail, metadata)
    VALUES ('scout', 'run_complete', $1, $2::jsonb)
  `, [logMsg, JSON.stringify({ strategy: strategyName, inserted, candidates: candidates.length })]);

  return { found: inserted, skipped: candidates.length - inserted };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
