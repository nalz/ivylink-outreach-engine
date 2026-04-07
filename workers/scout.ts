// ============================================================
// workers/scout.ts — IvyLink Outreach Scout v2
// ============================================================
// Architecture:
//   Phase 1: Parallel Apify hashtag runs across owner-specific tags
//   Phase 2: Batch profile fetch with structured post data
//   Phase 3: Strict owner qualification + Track A/B classification
//   Phase 4: Insert to DB with full enrichment
// ============================================================

import { Pool } from 'pg';

// ── Unicode sanitization ──────────────────────────────────────────────────────

function sanitize(str: string): string {
  if (!str) return str;
  return str.replace(/[\uD800-\uDFFF]/g, '\uFFFD');
}
function sanitizeArr(arr: string[]): string[] {
  return (arr ?? []).map(sanitize);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const APIFY_TOKEN   = process.env.APIFY_TOKEN!;
const APIFY_ACTOR   = 'apify~instagram-scraper';
const APIFY_BASE    = 'https://api.apify.com/v2';

const MAX_PROFILE_LOOKUPS = 80;  // handles to enrich in Phase 2
const DAILY_LIMIT         = 60;  // raised — more headroom as quality improves
const MIN_GAP_MINUTES     = 25;

// ── Permanent exclusion list ──────────────────────────────────────────────────

const PERMANENT_EXCLUSIONS = new Set([
  'hlmedspa.official','time2dripmedspa','thegardenmedspanj','luminarymedspa',
  'glowbarmedspa','njlasercenter','aestheticsbydesignnj','beautybynaturemedspanj',
  'skinlabnj','elitemedspanj',
  'inmodeaesthetics','hydrafacial','facerealityskincare','allergan','galderma',
  'revanceclinical','merz.aesthetics','vagaro','mindbodyapp','gloassistant',
  'clinicgrower','medspaalliance','aestheticrecord',
]);

// ── Hashtag groups (run in parallel) ─────────────────────────────────────────

// Geo + treatment combos = almost always actual providers posting their own work.
// Business/marketing hashtags (#medspabusiness, #medspamarketing) are dropped —
// they attract vendors and consultants who sell TO med spas, not owners.
const HASHTAG_GROUPS = [
  // NJ city-level — highest signal, almost exclusively local providers
  ['#hobokenmedspa','#jerseycitymedspa','#montclairmedspa','#summitmedspa',
   '#princetonmedspa','#morristownmedspa','#newjerseymedspa','#njmedspa','#njbotox','#njfiller'],
  // NYC borough + suburb geo
  ['#nycmedspa','#manhattanmedspa','#brooklynmedspa','#longislandmedspa',
   '#westchestermedspa','#nycbotox','#nycfiller','#nycaesthetics','#njaesthetics'],
  // Geo + treatment combos
  ['#njhydrafacial','#njmicroneedling','#njlaser','#nychydrafacial',
   '#nycmicroneedling','#nycskincare','#njskincare','#njinjector','#nycinjector'],
  // Credential-based — licensed providers (NPs, PAs, RNs) who typically own their practice
  // Narrow enough that most posters are the actual provider, not clients or vendors
  ['#nurseinjector','#aestheticnurse','#aestheticnp','#aestheticpa',
   '#njnurseinjector','#nycnurseinjector','#njnp','#njpa','#aestheticnursepractitioner'],
];

// ── Geographic filter ─────────────────────────────────────────────────────────

const GEO_REJECT = [
  'essex','london','manchester','birmingham','glasgow','edinburgh',
  ' uk','united kingdom','england','scotland','wales',
  'australia','canada','dubai','singapore','nigeria',
  'los angeles',' miami','chicago','dallas','houston','phoenix',
  'seattle','denver','atlanta','las vegas',
];

const GEO_ACCEPT = [
  'new jersey',' nj','new york',' nyc',' ny ',
  'hoboken','jersey city','montclair','summit','princeton',
  'morristown','westfield','ridgewood','short hills',
  'manhattan','brooklyn','queens','bronx','staten island',
  'long island','westchester','nassau','suffolk',
];

function isGeoMatch(bio: string | null | undefined, localSignals: string[]): boolean {
  const text = `${bio ?? ''} ${(localSignals ?? []).join(' ')}`.toLowerCase();
  if (GEO_REJECT.some(s => text.includes(s))) return false;
  return true;
}


const OWNER_SIGNALS = [
  'owner','founder','co-founder','cofounder','ceo',
  'my spa','my clinic','my practice','my studio','my medspa',
  'i own','we own','opened','established','founded',
  'pa-c','fnp','fnp-c','dnp','aprn','np-c','physician','md ','do ','rn bsn',
];

const EMPLOYEE_PATTERNS = [
  // "aesthetician @place" or "esthetician at @place"
  /aesthetician\s+@/i,
  /esthetician\s+@/i,
  /injector\s+@/i,
  /provider\s+@/i,
  /specialist\s+@/i,
  /expert\s+@/i,
  /artist\s+@/i,
  // "at @place" or "| @place"
  /\bat\s+@\w{3,}/i,
  /\|\s*@\w+(medspa|spa|clinic|aesthetics|beauty|studio)/i,
  // "working at" or "based at"
  /working\s+at\s+@/i,
  /based\s+at\s+@/i,
  // "team member of" or "proud member"
  /team\s+(member|of)\s+@/i,
  /proud\s+(member|part)\s+of\s+@/i,
];

const ICP_KEYWORDS = [
  'med spa','medspa','medical spa','aesthetics','esthetics',
  'injectables','injector','botox','filler','microneedling',
  'laser','skincare','hydrafacial','anti-aging','body contouring',
  'wellness clinic','iv therapy','hormone','skin clinic',
];

function isOwner(account: {
  username: string; biography: string; displayName: string;
  followersCount: number; isPrivate: boolean;
  category?: string; isBusinessAccount?: boolean;
}): { qualified: boolean; reason: string } {
  if (account.isPrivate) return { qualified: false, reason: 'private' };
  if (PERMANENT_EXCLUSIONS.has(account.username)) return { qualified: false, reason: 'exclusion list' };
  if (account.followersCount < 400 || account.followersCount > 150_000) {
    return { qualified: false, reason: `followers ${account.followersCount}` };
  }

  const bio = (account.biography ?? '').toLowerCase();
  const name = (account.displayName ?? '').toLowerCase();

  const badCategories = ['esthetician','makeup artist','hair salon','nail salon','tattoo'];
  if (account.category && badCategories.some(c => account.category!.toLowerCase().includes(c))) {
    return { qualified: false, reason: `category: ${account.category}` };
  }

  // Reject vendor/agency/software bios
  const vendorSignals = [
    'agency', 'software', 'saas', 'platform', 'app for', 'tool for',
    'we help med spa', 'we help medspa', 'helping med spa', 'for med spas',
    'marketing for', 'grow your', 'scale your', 'ai for',
    'academy', 'course', 'coaching', 'consultant', 'distributor', 'supplier',
  ];
  if (vendorSignals.some(v => bio.includes(v))) {
    return { qualified: false, reason: 'vendor/agency bio signal' };
  }

  const hasIcp = ICP_KEYWORDS.some(kw => bio.includes(kw) || name.includes(kw));
  if (!hasIcp) return { qualified: false, reason: 'no ICP keyword' };

  if (!isGeoMatch(account.biography, [])) {
    return { qualified: false, reason: 'non NJ/NYC geography' };
  }

  for (const pattern of EMPLOYEE_PATTERNS) {
    if (pattern.test(account.biography ?? '')) {
      return { qualified: false, reason: 'employee pattern' };
    }
  }

  const hasOwner = OWNER_SIGNALS.some(sig => bio.includes(sig))
    || /^[A-Z][a-zA-Z\s]+(Med Spa|Medspa|Aesthetics|Clinic|Studio|Wellness)/i.test(account.displayName ?? '');

  if (!hasOwner) {
    const softPass = account.isBusinessAccount && account.followersCount > 800
      && (account.category ?? '').toLowerCase().includes('spa');
    if (!softPass) return { qualified: false, reason: 'no ownership signal' };
  }

  return { qualified: true, reason: 'passed' };
}

// ── Track A/B classification ──────────────────────────────────────────────────

// Known product/equipment brands — tagging these is NOT a local business collab
const PRODUCT_BRANDS = new Set([
  'platedskinscience','skinbetter','allergan','hydrafacial','inmode',
  'galderma','merz','revance','botox','juvederm','restylane','sculptra',
  'kybella','coolsculpting','zeltiq','solta','cutera','syneron',
  'candela','lumenis','cynosure','sciton','venus','btlbody',
  'emsculpt','morpheus8','sofwave','ultherapy','thermage',
  'facerealityskincare','skinceuticals','obagi','zetaon','isdin',
  'colorescience','eltamd','sunbetter','latisse','xeomin','dysport',
  'radiesse','belotero','teoxane','stylage','perfectha',
]);

function classifyTrack(profile: {
  recentCaptions: string[]; collabSignals: string[]; bio: string;
}): 'A' | 'B' {
  // Only count tagged accounts that are NOT known product brands
  const localBusinessTags = profile.collabSignals.filter(
    handle => !PRODUCT_BRANDS.has(handle.toLowerCase().replace('@',''))
  );

  const captionText = profile.recentCaptions.join(' ').toLowerCase();
  const bioLower = (profile.bio ?? '').toLowerCase();

  // Phrases that indicate an ONGOING local business partnership
  // (not one-off events or general collaboration language)
  const ongoingCollabPhrases = [
    'our partner', 'partnered with', 'partnership with',
    'collab with', 'collaboration with', 'referral partner',
    'worked with', 'teamed up with', 'joining forces with',
    'proud to partner', 'excited to partner',
  ];

  // Phrases that indicate a one-off event/expo — NOT a Track A signal
  const oneOffEventPhrases = [
    'expo', 'event', 'pop-up', 'popup', 'conference', 'fair',
    'health fair', 'vendor', 'booth', 'join us at', 'come see us',
    'come find us', 'come visit', 'pulling up to', 'showing up at',
  ];

  // Caption has collab language AND it's not just an expo appearance
  const captionHasOngoingCollab = ongoingCollabPhrases.some(p => captionText.includes(p))
    && !oneOffEventPhrases.some(p => captionText.includes(p));

  // Bio explicitly signals openness to ongoing partnerships
  const bioHasCollab = [
    'collab', 'partnership', 'partner with us', 'open to collab',
    'open to partnerships', 'accepting collabs',
  ].some(p => bioLower.includes(p));

  // Must have BOTH local business tags AND ongoing collab language to be Track A
  // A tagged account alone (from expo, event, photo credit) is not enough
  const hasLocalPartnerWithContext = localBusinessTags.length > 0 && captionHasOngoingCollab;

  return (hasLocalPartnerWithContext || bioHasCollab) ? 'A' : 'B';
}

// ── Apify helpers ─────────────────────────────────────────────────────────────

async function startRun(input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify start failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { data: { id: string } };
  return data.data.id;
}

async function pollRun(runId: string, timeoutSecs = 120): Promise<unknown[]> {
  const maxPolls = Math.floor(timeoutSecs / 5);
  for (let i = 0; i < maxPolls; i++) {
    await sleep(5000);
    const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const data = await res.json() as { data: { status: string; defaultDatasetId: string } };
    const { status, defaultDatasetId } = data.data;
    if (status === 'SUCCEEDED') {
      const r = await fetch(`${APIFY_BASE}/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=150`);
      const items = await r.json() as unknown[];
      return Array.isArray(items) ? items : [];
    }
    if (['FAILED','ABORTED','TIMED-OUT'].includes(status)) throw new Error(`Run ${runId}: ${status}`);
  }
  throw new Error(`Run ${runId} timed out`);
}

// ── Phase 1: Parallel hashtag scrape → lightweight candidate objects ──────────

interface Phase1Candidate {
  username: string;
  displayName: string;
  followersCount: number;
  biography: string;    // may be empty if Apify doesn't return it on posts
  isPrivate: boolean;
}

async function getHandlesFromHashtags(): Promise<Phase1Candidate[]> {
  console.log(`[scout] Phase 1: starting ${HASHTAG_GROUPS.length} parallel hashtag runs`);

  const runIds = await Promise.all(
    HASHTAG_GROUPS.map(hashtags =>
      startRun({
        directUrls: hashtags.map(h => `https://www.instagram.com/explore/tags/${h.replace('#','')}/`),
        resultsType: 'posts',
        resultsLimit: 50,
      }).catch(err => { console.error('[scout] Run start error:', err); return null; })
    )
  );

  const results = await Promise.all(
    runIds.map(id => id ? pollRun(id, 120).catch(() => [] as unknown[]) : Promise.resolve([] as unknown[]))
  );

  // Deduplicate by username — keep first occurrence
  const seen = new Set<string>();
  const candidates: Phase1Candidate[] = [];

  for (const items of results) {
    for (const item of items) {
      const post = item as {
        ownerUsername?: string;
        ownerFullName?: string;
        biography?: string;
        ownersFollowersCount?: number;
        followersCount?: number;
        isPrivate?: boolean;
        owner?: {
          username?: string;
          fullName?: string;
          biography?: string;
          followersCount?: number;
          isPrivate?: boolean;
        };
      };

      const username = post.ownerUsername ?? post.owner?.username ?? '';
      if (!username || seen.has(username) || PERMANENT_EXCLUSIONS.has(username)) continue;
      seen.add(username);

      candidates.push({
        username,
        displayName: post.ownerFullName ?? post.owner?.fullName ?? '',
        biography: post.biography ?? post.owner?.biography ?? '',
        followersCount: post.ownersFollowersCount ?? post.followersCount ?? post.owner?.followersCount ?? 0,
        isPrivate: post.isPrivate ?? post.owner?.isPrivate ?? false,
      });
    }
  }

  const totalPosts = results.flat().length;
  const withBio = candidates.filter(c => c.biography.length > 0).length;
  const withFollowers = candidates.filter(c => c.followersCount > 0).length;
  console.log(`[scout] Phase 1: ${candidates.length} unique accounts from ${totalPosts} posts (bio=${withBio} followers=${withFollowers})`);

  return candidates;
}

// ── Phase 1.5: Pre-filter all candidates before expensive profile enrichment ───
// Applies as much of isOwner() as possible from Phase 1 data.
// Accounts without bio data get a soft pass — Phase 2 enrichment decides.

function preFilter(
  candidate: Phase1Candidate,
  knownHandles: Set<string>
): { pass: boolean; reason: string } {
  if (knownHandles.has(candidate.username)) return { pass: false, reason: 'already known' };
  if (candidate.isPrivate) return { pass: false, reason: 'private' };

  // Follower range only if we have data
  if (candidate.followersCount > 0) {
    if (candidate.followersCount < 400 || candidate.followersCount > 150_000) {
      return { pass: false, reason: `followers ${candidate.followersCount}` };
    }
  }

  // Bio checks only if bio is present
  if (candidate.biography.length > 0) {
    const bio = candidate.biography.toLowerCase();
    const name = candidate.displayName.toLowerCase();

    const vendorSignals = [
      'agency','software','saas','platform','app for','tool for',
      'we help med spa','we help medspa','helping med spa','for med spas',
      'marketing for','grow your','scale your','ai for',
      'academy','course','coaching','consultant','distributor','supplier',
    ];
    if (vendorSignals.some(v => bio.includes(v))) return { pass: false, reason: 'vendor/agency' };

    const hasIcp = ICP_KEYWORDS.some(kw => bio.includes(kw) || name.includes(kw));
    if (!hasIcp) return { pass: false, reason: 'no ICP keyword' };

    if (!isGeoMatch(candidate.biography, [])) return { pass: false, reason: 'non NJ/NYC geography' };

    for (const pattern of EMPLOYEE_PATTERNS) {
      if (pattern.test(candidate.biography)) return { pass: false, reason: 'employee pattern' };
    }
  }

  return {
    pass: true,
    reason: candidate.biography.length === 0 ? 'soft pass (no bio in Phase 1)' : 'passed pre-filter',
  };
}

// ── Phase 2: Batch profile enrichment ─────────────────────────────────────────

interface EnrichedProfile {
  username: string; displayName: string; biography: string;
  followersCount: number; followsCount: number; postsCount: number;
  isPrivate: boolean; isBusinessAccount: boolean; category: string;
  hasBookingLink: boolean; usesStories: boolean;
  recentPosts: Array<{
    type: 'reel'|'photo'|'carousel'; daysAgo: number;
    url: string; captionSnippet: string; tagged: string[];
    location: string; hashtags: string[];
  }>;
  recentCaptions: string[];
  collabSignals: string[];
  localSignals: string[];
  contentThemes: string[];
}

async function enrichProfiles(handles: string[]): Promise<EnrichedProfile[]> {
  if (handles.length === 0) return [];
  console.log(`[scout] Phase 2: enriching ${handles.length} profiles`);

  const runId = await startRun({
    directUrls: handles.map(h => `https://www.instagram.com/${h}/`),
    resultsType: 'details',
    resultsLimit: 1,
  });

  const items = await pollRun(runId, 180);
  console.log(`[scout] Phase 2: ${items.length} profiles returned`);

  return items.map((item) => {
    const p = item as {
      username?: string; fullName?: string; biography?: string;
      followersCount?: number; followsCount?: number; postsCount?: number;
      isPrivate?: boolean; isBusinessAccount?: boolean;
      businessCategoryName?: string; categoryName?: string;
      externalUrl?: string; highlightReelCount?: number;
      latestPosts?: Array<{
        type?: string; timestamp?: string; caption?: string;
        hashtags?: string[];
        url?: string; shortCode?: string;
        taggedUsers?: Array<{ username?: string }>;
        locationName?: string;
        coauthorProducers?: Array<{ username?: string }>;
        // Explicitly NOT capturing: firstComment, latestComments, ownerUsername
        // Comment authors are NOT collaborators and must never reach the analyst
      }>;
    };

    const now = Date.now();
    const posts = p.latestPosts ?? [];

    const recentPosts = posts
      .slice(0, 6)
      .map(post => {
        const ts = post.timestamp ? new Date(post.timestamp).getTime() : now;
        const daysAgo = Math.round((now - ts) / 86_400_000);
        const type = (post.type ?? '').toLowerCase().includes('reel') ? 'reel'
          : (post.type ?? '').toLowerCase().includes('carousel') ? 'carousel' : 'photo';
        const tagged = [
          ...(post.taggedUsers ?? []).map(u => u.username ?? ''),
          ...(post.coauthorProducers ?? []).map(u => u.username ?? ''),
          // NOTE: latestComments and firstComment are intentionally excluded
          // Comment authors are NOT business partners and must not appear in collabSignals
        ].filter(Boolean).filter(u => !PERMANENT_EXCLUSIONS.has(u));

        return {
          type: type as 'reel'|'photo'|'carousel',
          daysAgo,
          url: post.url ?? (post.shortCode ? `https://instagram.com/p/${post.shortCode}/` : ''),
          captionSnippet: sanitize((post.caption ?? '').slice(0, 280)),
          tagged,
          location: sanitize(post.locationName ?? ''),
          hashtags: (post.hashtags ?? []).slice(0, 8),
        };
      })
      .filter(post => post.daysAgo <= 60); // Only include posts from last 60 days

    const recentCaptions = recentPosts.map(p => p.captionSnippet).filter(Boolean);
    const collabSignals = [...new Set(recentPosts.flatMap(p => p.tagged))].slice(0, 8);
    const localSignals = [...new Set(recentPosts.map(p => p.location).filter(Boolean))].slice(0, 5);
    const contentThemes = [...new Set(recentPosts.flatMap(p => p.hashtags))].slice(0, 15);

    const bioLower = (p.biography ?? '').toLowerCase();
    const hasBookingLink = !!(p.externalUrl) ||
      ['book','booking','schedule','calendly','vagaro','mindbody'].some(kw => bioLower.includes(kw));

    return {
      username: p.username ?? '',
      displayName: sanitize(p.fullName ?? ''),
      biography: sanitize(p.biography ?? ''),
      followersCount: p.followersCount ?? 0,
      followsCount: p.followsCount ?? 0,
      postsCount: p.postsCount ?? 0,
      isPrivate: p.isPrivate ?? false,
      isBusinessAccount: p.isBusinessAccount ?? false,
      category: p.businessCategoryName ?? p.categoryName ?? '',
      hasBookingLink,
      usesStories: (p.highlightReelCount ?? 0) > 0,
      recentPosts,
      recentCaptions: sanitizeArr(recentCaptions),
      collabSignals: sanitizeArr(collabSignals),
      localSignals: sanitizeArr(localSignals),
      contentThemes: sanitizeArr(contentThemes),
    };
  }).filter(p => p.username !== '');
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runScout(pool: Pool): Promise<{
  found: number; skipped: number; refusalReason?: string;
}> {
  const today = new Date().toISOString().split('T')[0];

  const { rows: [memory] } = await pool.query<{
    daily_discovery_count: number;
    discovered_handles: string[];
    last_run: string | null;
  }>(`INSERT INTO scout_memory (date) VALUES ($1) ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date RETURNING *`, [today]);

  if (memory.last_run) {
    const gapMin = (Date.now() - new Date(memory.last_run).getTime()) / 60_000;
    if (gapMin < MIN_GAP_MINUTES) {
      const reason = `Gap check: ${Math.round(gapMin)}m ago (min ${MIN_GAP_MINUTES}m)`;
      console.log(`[scout] Refused: ${reason}`);
      await pool.query(`UPDATE scout_memory SET refused_runs = refused_runs + 1, updated_at = NOW() WHERE date = $1`, [today]);
      return { found: 0, skipped: 0, refusalReason: reason };
    }
  }

  if (memory.daily_discovery_count >= DAILY_LIMIT) {
    return { found: 0, skipped: 0, refusalReason: `Daily limit ${memory.daily_discovery_count}/${DAILY_LIMIT}` };
  }

  await pool.query(`UPDATE scout_memory SET last_run = NOW(), updated_at = NOW() WHERE date = $1`, [today]);

  const { rows: knownRows } = await pool.query<{ handle: string }>(`SELECT handle FROM prospects`);
  const knownHandles = new Set([
    ...knownRows.map(r => r.handle),
    ...(memory.discovered_handles as string[] ?? []),
    ...PERMANENT_EXCLUSIONS,
  ]);

  let phase1Candidates: Phase1Candidate[] = [];
  try {
    phase1Candidates = await getHandlesFromHashtags();
  } catch (err) {
    return { found: 0, skipped: 0, refusalReason: `Phase 1 error: ${err}` };
  }

  // ── Phase 1.5: Pre-filter all candidates using available Phase 1 data ─────────
  // This eliminates vendors, employees, wrong geo, and out-of-range follower counts
  // BEFORE spending Apify credits on full profile enrichment.

  const preFilterResults = phase1Candidates.map(c => ({
    candidate: c,
    ...preFilter(c, knownHandles),
  }));

  const passed = preFilterResults.filter(r => r.pass);
  const rejected = preFilterResults.filter(r => !r.pass);

  console.log(`[scout] Phase 1.5 pre-filter: ${passed.length} passed / ${rejected.length} rejected from ${phase1Candidates.length} total`);

  // Log rejection reasons summary
  const reasons: Record<string, number> = {};
  for (const r of rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  console.log(`[scout] Rejection reasons: ${Object.entries(reasons).map(([k,v]) => `${k}=${v}`).join(', ')}`);

  if (passed.length === 0) return { found: 0, skipped: phase1Candidates.length };

  // Shuffle passed candidates — get variety across runs
  // Then take up to MAX_PROFILE_LOOKUPS for Phase 2 enrichment
  const toEnrich = passed
    .map(r => r.candidate.username)
    .sort(() => Math.random() - 0.5)
    .slice(0, MAX_PROFILE_LOOKUPS);

  console.log(`[scout] Phase 2: enriching ${toEnrich.length} pre-filtered profiles (${passed.length - toEnrich.length} passed but not enriched this run)`);

  let profiles: EnrichedProfile[] = [];
  try {
    profiles = await enrichProfiles(toEnrich);
  } catch (err) {
    return { found: 0, skipped: 0, refusalReason: `Phase 2 error: ${err}` };
  }

  if (profiles.length > 0) {
    console.log(`[scout] Categories: ${profiles.slice(0,5).map(p => `@${p.username}="${p.category}"`).join(', ')}`);
  }

  const qualified: Array<EnrichedProfile & { track: 'A'|'B' }> = [];

  for (const profile of profiles) {
    if (knownHandles.has(profile.username)) continue;

    // Minimum post activity — inactive accounts aren't worth reaching out to
    if (profile.postsCount < 9) {
      console.log(`[scout] Skip @${profile.username}: too few posts (${profile.postsCount})`);
      continue;
    }
    // Must have posted recently — check if any post is within 30 days
    const hasRecentPost = profile.recentPosts.some(p => p.daysAgo <= 30);
    if (!hasRecentPost && profile.recentPosts.length > 0) {
      console.log(`[scout] Skip @${profile.username}: no posts in last 30 days`);
      continue;
    }

    const { qualified: isQ, reason } = isOwner({
      username: profile.username, biography: profile.biography,
      displayName: profile.displayName, followersCount: profile.followersCount,
      isPrivate: profile.isPrivate, category: profile.category,
      isBusinessAccount: profile.isBusinessAccount,
    });
    if (!isQ) { console.log(`[scout] Skip @${profile.username}: ${reason}`); continue; }
    const track = classifyTrack({ recentCaptions: profile.recentCaptions, collabSignals: profile.collabSignals, bio: profile.biography });
    console.log(`[scout] Qualified @${profile.username} (${profile.followersCount}f) → Track ${track}`);
    qualified.push({ ...profile, track });
  }

  let inserted = 0;
  const insertedHandles: string[] = [];

  for (const p of qualified) {
    const structuredPosts = p.recentPosts.map(post => ({
      type: post.type, days_ago: post.daysAgo,
      url: post.url,
      caption: post.captionSnippet,
      tagged: post.tagged, location: post.location, hashtags: post.hashtags,
    }));

    const { rowCount } = await pool.query(`
      INSERT INTO prospects (
        handle, name, bio, follower_count, following_count, post_count,
        discovered_via, source_detail, has_booking_link, uses_stories,
        recent_captions, collab_signals, local_signals, content_themes, notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,'hashtag',$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14)
      ON CONFLICT (handle) DO NOTHING
    `, [
      p.username, sanitize(p.displayName), sanitize(p.biography),
      p.followersCount, p.followsCount, p.postsCount,
      HASHTAG_GROUPS.flat().slice(0,3).join(', '),
      p.hasBookingLink, p.usesStories,
      JSON.stringify(p.recentCaptions),
      JSON.stringify(p.collabSignals),
      JSON.stringify(p.localSignals),
      JSON.stringify(p.contentThemes),
      JSON.stringify({ track: p.track, structured_posts: structuredPosts }),
    ]);

    if (rowCount && rowCount > 0) {
      inserted++;
      insertedHandles.push(p.username);
      await pool.query(`INSERT INTO activity_log (source, action, detail) VALUES ('scout','discovered',$1)`,
        [`@${p.username} Track ${p.track} — ${p.followersCount} followers`]);
      console.log(`[scout] Added @${p.username} Track ${p.track}`);
    }
  }

  await pool.query(`
    UPDATE scout_memory SET
      daily_discovery_count = daily_discovery_count + $1,
      strategy_index = strategy_index + 1,
      discovered_handles = discovered_handles || $2::jsonb,
      updated_at = NOW()
    WHERE date = $3
  `, [inserted, JSON.stringify(insertedHandles), today]);

  console.log(`[scout] Done: ${inserted} added / ${qualified.length} qualified / ${profiles.length} enriched / ${toEnrich.length} to enrich / ${passed.length} pre-filter passed / ${phase1Candidates.length} raw`);
  return { found: inserted, skipped: profiles.length - inserted };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
