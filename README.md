# IvyLink Instagram Outreach Engine

Manual Action Center for IvyLink's med spa Instagram outreach.
AI handles discovery and drafting. You perform every social action yourself. Zero account risk.

---

## Architecture

```
Railway Cron (hourly)
  └── radar.ts          ← Master orchestrator
        ├── scout.ts    ← Apify: discovers new med spa owners
        └── analyst.ts  ← Claude Sonnet: scores + generates DMs

Next.js App (always on)
  └── /outreach         ← Protected Action Center dashboard
        ├── GET /api/outreach/queue    ← Ready + follow-up queues
        └── PATCH /api/outreach/[id]  ← Status updates

Neon PostgreSQL
  ├── prospects          ← Core lead records
  ├── prospect_content   ← AI-generated copy
  ├── scout_memory       ← Daily discovery tracking
  ├── radar_memory       ← Orchestrator state
  ├── analyst_memory     ← AI run tracking
  └── activity_log       ← Queryable audit trail
```

---

## Project Structure

```
├── db/
│   └── schema.sql              # Run once against Neon
├── workers/
│   ├── radar.ts                # Railway cron entry point
│   ├── analyst.ts              # Claude API scoring + DM generation
│   ├── analyst-prompt.ts       # The system prompt (the intelligence layer)
│   └── scout.ts                # Apify Instagram discovery
├── src/
│   ├── app/
│   │   ├── login/page.tsx      # Single-user auth page
│   │   ├── outreach/page.tsx   # Main Action Center dashboard
│   │   └── api/
│   │       ├── auth/           # Login + logout endpoints
│   │       └── outreach/       # Queue + status API routes
│   ├── lib/
│   │   ├── auth.ts             # JWT session management
│   │   └── db.ts               # Neon query helpers
│   ├── middleware.ts            # Protects all /outreach routes
│   └── types/index.ts          # Shared TypeScript types
└── .env.example                # Required environment variables
```

---

## Setup

### 1. Neon Database

```bash
# Run the schema against your Neon database
psql $DATABASE_URL -f db/schema.sql
```

### 2. Environment Variables

```bash
cp .env.example .env.local
# Fill in all values
```

Required:
- `UI_ADMIN_KEY` — Your dashboard password
- `DATABASE_URL` — Neon connection string
- `ANTHROPIC_API_KEY` — Claude Sonnet API key
- `APIFY_TOKEN` — Apify API token (Instagram Scraper actor)

### 3. Local Development

```bash
npm install
npm run dev
# → http://localhost:3000/outreach (redirects to /login first)
```

---

## Railway Deployment

### Web Service (Next.js Dashboard)

1. Create a new Railway project
2. Connect your GitHub repo
3. Set environment variables from `.env.example`
4. Build command: `npm run build`
5. Start command: `npm run start`

### Cron Service (Radar)

1. Add a second Railway service in the same project
2. Set it as a **Cron** service
3. Command: `npm run radar`
4. Schedule: `0 7-23 * * *` (every hour, 7am-11pm)
5. Use the **same** environment variables as the web service

---

## How the Pipeline Works

### Discovery (Scout)
The hourly radar checks if the ready queue is low, then triggers Apify to find 1-2 new med spa Instagram accounts matching the ICP:
- NJ-based preferred
- 200-50k followers (owner range)
- Active in last 14 days
- Bio signals: med spa, aesthetics, injectables

### Scoring + DM Generation (Analyst)
Claude Sonnet evaluates each discovered prospect against a strict 100-point rubric:

| Category | Weight |
|---|---|
| Collab Behavior | 25 pts |
| Local Relevance | 20 pts |
| Content Proof | 20 pts |
| Conversion Intent | 15 pts |
| Engagement Quality | 10 pts |
| Brand Fit | 10 pts |

Prospects scoring ≥ 70 get:
- 3 DM variants (different styles)
- 1 story reply
- 1 post comment
- 1 follow-up DM (for 7-day mark)

### Your Workflow (Action Center)

**Warmup phase (24-48h before DM):**
1. Open the prospect in the Action Center
2. Click "View Profile" → like one of their recent posts
3. If they have a story, reply with the generated story reply text
4. Leave the generated post comment on their most recent post
5. Mark each warmup action done in the dashboard

**Outreach phase:**
1. Pick a DM variant (Style A/B/C/D/E)
2. Click "Open DM" → Instagram direct message opens
3. Copy the DM text → paste and send manually
4. Click "Mark as Messaged" in the dashboard

**Follow-up phase (day 7+, no reply):**
1. Follow-up tab shows leads messaged 7+ days ago
2. Copy the follow-up text → send manually
3. Mark as sent — that's it, one follow-up maximum

---

## The Nalin Voice (DM Rules)

Hard constraints applied by the analyst:
- Always opens with: `Hey [FirstName],`
- 2-3 sentences maximum
- One specific content reference (a real post, collab, reel)
- No em dashes
- No exclamation marks
- No generic openers ("love your page")
- No pitch, pricing, or links
- No urgency language
- Peer-to-peer tone, not vendor-to-buyer

---

## Security

- All `/outreach` routes require authentication
- Single user: validates against `UI_ADMIN_KEY` env var
- Stateless JWT session, 24h expiry, HttpOnly cookie
- Timing-safe key comparison on login
- No Instagram credentials stored anywhere — actions are manual

---

## Daily Limits (Built In)

| Limit | Value |
|---|---|
| DMs per day | 8 max |
| Discoveries per day | 30 max |
| Scout min gap | 25 minutes |
| DMs per scout run | 2 max |
| Random skip rate | ~20% of runs |
| Active hours | 7am – 11pm |

These limits are enforced in the radar/scout workers and cannot be bypassed from the dashboard.
