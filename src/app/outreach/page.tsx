'use client';

// ============================================================
// src/app/outreach/page.tsx — IvyLink Manual Action Center
// ============================================================
// The complete copy-paste outreach dashboard.
// All Instagram actions are performed manually by the user.
// This UI provides the links and the text. Nothing is automated.
// ============================================================

import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Prospect {
  id: string;
  handle: string;
  name: string | null;
  bio: string | null;
  profile_url: string;
  dm_url: string;
  follower_count: number;
  score: number;
  score_collab_behavior: number;
  score_local_relevance: number;
  score_content_proof: number;
  score_conversion_intent: number;
  score_engagement_quality: number;
  score_brand_fit: number;
  score_reasoning: string | null;
  collab_signals: string[];
  local_signals: string[];
  intent_signals: string[];
  liked_post: boolean;
  story_reply_sent: boolean;
  post_commented: boolean;
  warmup_complete: boolean;
  // content
  dm_variant_1: string | null;
  dm_variant_1_style: string | null;
  dm_variant_2: string | null;
  dm_variant_2_style: string | null;
  dm_variant_3: string | null;
  dm_variant_3_style: string | null;
  story_reply: string | null;
  post_comment: string | null;
  // follow-up specific
  follow_up_dm?: string | null;
  dm_sent_at?: string | null;
  days_since_dm?: string;
}

interface PipelineHealth {
  discovered: number;
  enriched: number;
  scored: number;
  ready: number;
  messaged: number;
  skipped: number;
  rejected: number;
  total: number;
}

type Tab = 'ready' | 'followup';

// ── Color tokens ──────────────────────────────────────────────────────────────

const C = {
  bg: '#0c0c0d',
  surface: '#141416',
  surfaceHover: '#1c1c1f',
  border: '#232326',
  borderStrong: '#2e2e32',
  coral: '#E8604A',
  coralDim: '#c44d38',
  tangerine: '#F28B5F',
  text: '#f0f0f0',
  textMuted: '#7a7a80',
  textDim: '#4a4a50',
  green: '#4ade80',
  greenDim: '#166534',
  amber: '#fbbf24',
  red: '#f87171',
  badge: '#1e1e22',
};

// ── Score bar component ───────────────────────────────────────────────────────

function ScoreBar({ label, value, max, color = C.coral }: {
  label: string; value: number; max: number; color?: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: C.textMuted }}>{label}</span>
        <span style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>{value}/{max}</span>
      </div>
      <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        padding: '5px 12px',
        background: copied ? C.greenDim : C.badge,
        border: `1px solid ${copied ? C.green : C.borderStrong}`,
        borderRadius: 6,
        color: copied ? C.green : C.textMuted,
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        letterSpacing: '0.03em',
      }}
    >
      {copied ? '✓ Copied' : (label ?? 'Copy')}
    </button>
  );
}

// ── Text block with copy button ───────────────────────────────────────────────

function CopyBlock({ text, label, dimmed }: { text: string | null; label: string; dimmed?: boolean }) {
  if (!text) return null;
  return (
    <div style={{
      background: dimmed ? C.bg : '#0f0f11',
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: '12px 14px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            {label}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {text}
          </p>
        </div>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

// ── Category header ───────────────────────────────────────────────────────────

function CategoryHeader({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: `linear-gradient(135deg, ${C.coral}, ${C.tangerine})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0,
      }}>
        {number}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{title}</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>{subtitle}</div>
      </div>
    </div>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────

function ActionButton({
  label, onClick, variant = 'default', disabled,
}: {
  label: string; onClick: () => void; variant?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean;
}) {
  const styles = {
    default: { bg: C.badge, border: C.borderStrong, color: C.text },
    primary: { bg: C.coral, border: C.coral, color: '#fff' },
    danger: { bg: 'transparent', border: C.red, color: C.red },
    ghost: { bg: 'transparent', border: C.border, color: C.textMuted },
  };
  const s = styles[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px',
        background: disabled ? C.border : s.bg,
        border: `1px solid ${disabled ? C.border : s.border}`,
        borderRadius: 8,
        color: disabled ? C.textDim : s.color,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

// ── Warmup tracker ────────────────────────────────────────────────────────────

function WarmupTracker({
  prospect,
  onAction,
}: {
  prospect: Prospect;
  onAction: (action: string) => void;
}) {
  const steps = [
    { key: 'warmup_liked', label: 'Like a post', done: prospect.liked_post },
    { key: 'warmup_story', label: 'Reply to story', done: prospect.story_reply_sent },
    { key: 'warmup_comment', label: 'Leave comment', done: prospect.post_commented },
  ];

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: '10px 14px',
      marginBottom: 16,
    }}>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        Warmup Progress
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {steps.map((step) => (
          <button
            key={step.key}
            onClick={() => !step.done && onAction(step.key)}
            style={{
              flex: 1,
              padding: '7px 6px',
              background: step.done ? C.greenDim : C.surface,
              border: `1px solid ${step.done ? C.green : C.border}`,
              borderRadius: 6,
              color: step.done ? C.green : C.textMuted,
              fontSize: 11,
              fontWeight: 600,
              cursor: step.done ? 'default' : 'pointer',
              transition: 'all 0.15s',
              fontFamily: 'inherit',
              textAlign: 'center',
            }}
          >
            {step.done ? '✓ ' : ''}{step.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? C.green : score >= 70 ? C.amber : C.textMuted;
  const label = score >= 80 ? 'HOT' : score >= 70 ? 'QUEUE' : 'HOLD';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        fontSize: 22, fontWeight: 800, color,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {score}
      </div>
      <div style={{
        padding: '2px 7px',
        background: `${color}22`,
        border: `1px solid ${color}44`,
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 800,
        color,
        letterSpacing: '0.1em',
      }}>
        {label}
      </div>
    </div>
  );
}

// ── Prospect card ─────────────────────────────────────────────────────────────

function ProspectCard({
  prospect,
  onUpdate,
}: {
  prospect: Prospect;
  onUpdate: (id: string, action: string, sentText?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(0);

  const variants = [
    { text: prospect.dm_variant_1, style: prospect.dm_variant_1_style },
    { text: prospect.dm_variant_2, style: prospect.dm_variant_2_style },
    { text: prospect.dm_variant_3, style: prospect.dm_variant_3_style },
  ].filter((v) => v.text);

  const selectedDm = variants[selectedVariant]?.text ?? null;

  const handleMessaged = () => {
    if (!selectedDm) return;
    if (confirm(`Confirm: Did you send this DM to @${prospect.handle}?`)) {
      onUpdate(prospect.id, 'messaged', selectedDm);
    }
  };

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      marginBottom: 12,
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
              @{prospect.handle}
            </span>
            {prospect.name && (
              <span style={{ fontSize: 12, color: C.textMuted }}>{prospect.name}</span>
            )}
            <span style={{ fontSize: 11, color: C.textDim }}>
              {prospect.follower_count.toLocaleString()} followers
            </span>
          </div>
          {prospect.bio && (
            <p style={{
              margin: 0, fontSize: 12, color: C.textMuted,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 480,
            }}>
              {prospect.bio}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <ScoreBadge score={prospect.score} />
          <span style={{ fontSize: 16, color: C.textMuted, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>
            ↓
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '20px' }}>

          {/* Deep Links */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <a
              href={`https://instagram.com/${prospect.handle}/`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px',
                background: C.badge, border: `1px solid ${C.borderStrong}`,
                borderRadius: 8, color: C.text, fontSize: 12, fontWeight: 600,
                textDecoration: 'none', transition: 'border-color 0.15s',
              }}
            >
              ↗ View Profile
            </a>
            <a
              href={`https://ig.me/m/${prospect.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px',
                background: `${C.coral}18`, border: `1px solid ${C.coral}44`,
                borderRadius: 8, color: C.coral, fontSize: 12, fontWeight: 600,
                textDecoration: 'none', transition: 'all 0.15s',
              }}
            >
              ✉ Open DM
            </a>
          </div>

          {/* Score breakdown */}
          <div style={{
            background: C.bg, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '14px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
              Score Breakdown — {prospect.score}/100
            </div>
            <ScoreBar label="Collab Behavior" value={prospect.score_collab_behavior} max={25} />
            <ScoreBar label="Local Relevance" value={prospect.score_local_relevance} max={20} color={C.tangerine} />
            <ScoreBar label="Content Proof" value={prospect.score_content_proof} max={20} color="#a78bfa" />
            <ScoreBar label="Conversion Intent" value={prospect.score_conversion_intent} max={15} color={C.amber} />
            <ScoreBar label="Engagement Quality" value={prospect.score_engagement_quality} max={10} color={C.green} />
            <ScoreBar label="Brand Fit" value={prospect.score_brand_fit} max={10} color="#67e8f9" />
            {prospect.score_reasoning && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
                {prospect.score_reasoning}
              </p>
            )}
          </div>

          {/* Signals */}
          {(prospect.local_signals?.length > 0 || prospect.collab_signals?.length > 0) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
              {[...prospect.local_signals, ...prospect.collab_signals, ...prospect.intent_signals]
                .slice(0, 6)
                .map((sig, i) => (
                  <span key={i} style={{
                    padding: '3px 8px', background: C.badge,
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    fontSize: 11, color: C.textMuted,
                  }}>
                    {sig}
                  </span>
                ))}
            </div>
          )}

          {/* Warmup tracker */}
          <WarmupTracker prospect={prospect} onAction={(action) => onUpdate(prospect.id, action)} />

          {/* Category 1: Warmup copy */}
          <CategoryHeader number="1" title="Warmup" subtitle="Do these first, 24-48h before DM" />
          {prospect.story_reply
            ? <CopyBlock text={prospect.story_reply} label="Story Reply — paste this when they post a story" />
            : <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8, padding: '8px 12px', background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>No story reply generated — rerun analyst to regenerate copy.</div>
          }
          {prospect.post_comment
            ? <CopyBlock text={prospect.post_comment} label="Post Comment — leave on their most recent post" />
            : <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8, padding: '8px 12px', background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>No post comment generated — rerun analyst to regenerate copy.</div>
          }

          {/* Category 2: DM */}
          <div style={{ marginTop: 20, marginBottom: 4 }}>
            <CategoryHeader number="2" title="Outreach DM" subtitle="Send only after warmup. Pick one variant." />

            {variants.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textDim, padding: '8px 12px', background: C.bg, borderRadius: 6, border: `1px solid ${C.border}`, marginBottom: 12 }}>
                No DM variants generated — rerun analyst to regenerate copy.
              </div>
            ) : (
              <>
                {/* Variant picker */}
                {variants.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    {variants.map((v, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedVariant(i)}
                        style={{
                          padding: '4px 12px',
                          background: selectedVariant === i ? `${C.coral}22` : C.badge,
                          border: `1px solid ${selectedVariant === i ? C.coral : C.border}`,
                          borderRadius: 6,
                          color: selectedVariant === i ? C.coral : C.textMuted,
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Style {v.style ?? String.fromCharCode(65 + i)}
                      </button>
                    ))}
                  </div>
                )}

                {selectedDm && (
                  <div style={{
                    background: '#0f0f11',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '12px 14px', marginBottom: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.6, flex: 1, whiteSpace: 'pre-wrap' }}>
                        {selectedDm}
                      </p>
                      <CopyButton text={selectedDm} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Status controls */}
          <div style={{
            display: 'flex', gap: 8, paddingTop: 16,
            borderTop: `1px solid ${C.border}`, marginTop: 8,
          }}>
            <ActionButton
              label="✓ Mark as Messaged"
              variant="primary"
              onClick={handleMessaged}
              disabled={!selectedDm}
            />
            <ActionButton
              label="Skip"
              variant="danger"
              onClick={() => {
                if (confirm(`Skip @${prospect.handle}? They'll be removed from your queue.`)) {
                  onUpdate(prospect.id, 'skip');
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Follow-up card ────────────────────────────────────────────────────────────

function FollowUpCard({
  prospect,
  onUpdate,
}: {
  prospect: Prospect;
  onUpdate: (id: string, action: string, sentText?: string) => void;
}) {
  const daysSince = prospect.days_since_dm
    ? Math.floor(parseFloat(prospect.days_since_dm) / 86400 / 1e6)
    : '?';

  const handleSent = () => {
    if (!prospect.follow_up_dm) return;
    if (confirm(`Confirm: Did you send the follow-up to @${prospect.handle}?`)) {
      onUpdate(prospect.id, 'followup_sent', prospect.follow_up_dm);
    }
  };

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '16px 20px', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 3 }}>
            @{prospect.handle}
          </div>
          <div style={{ fontSize: 11, color: C.textDim }}>
            DM sent {daysSince} days ago · No reply
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={`https://ig.me/m/${prospect.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              background: `${C.coral}18`, border: `1px solid ${C.coral}44`,
              borderRadius: 7, color: C.coral, fontSize: 11, fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            ✉ Open DM
          </a>
        </div>
      </div>

      <CategoryHeader number="3" title="Follow-up DM" subtitle="Day 5-7 only, one time, then stop" />
      <CopyBlock text={prospect.follow_up_dm ?? null} label="Follow-up" />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <ActionButton
          label="✓ Follow-up Sent"
          variant="primary"
          onClick={handleSent}
          disabled={!prospect.follow_up_dm}
        />
      </div>
    </div>
  );
}

// ── Pipeline health bar ───────────────────────────────────────────────────────

function HealthBar({ health }: { health: PipelineHealth }) {
  const pills = [
    { label: 'Discovered', value: health.discovered, color: C.textMuted },
    { label: 'Scored', value: health.scored, color: C.amber },
    { label: 'Ready', value: health.ready, color: C.coral },
    { label: 'Messaged', value: health.messaged, color: C.green },
    { label: 'Skipped', value: health.skipped, color: C.textDim },
  ];

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
    }}>
      {pills.map((p) => (
        <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%', background: p.color,
          }} />
          <span style={{ fontSize: 12, color: C.textMuted }}>
            {p.value} <span style={{ color: C.textDim }}>{p.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutreachPage() {
  const [tab, setTab] = useState<Tab>('ready');
  const [ready, setReady] = useState<Prospect[]>([]);
  const [followUp, setFollowUp] = useState<Prospect[]>([]);
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/queue', { cache: 'no-store' });
      const data = await res.json() as { ready: Prospect[]; followUp: Prospect[]; health: PipelineHealth };
      setReady(data.ready ?? []);
      setFollowUp(data.followUp ?? []);
      setHealth(data.health);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleUpdate = useCallback(async (id: string, action: string, sentText?: string) => {
    try {
      const body: { action: string; sentText?: string } = { action };
      if (sentText) body.sentText = sentText;

      await fetch(`/api/outreach/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // Optimistically remove from visible queue for destructive actions
      if (action === 'messaged' || action === 'skip') {
        setReady((prev) => prev.filter((p) => p.id !== id));
      }
      if (action === 'followup_sent') {
        setFollowUp((prev) => prev.filter((p) => p.id !== id));
      }

      // Refresh health counts
      await loadQueue();

    } catch (err) {
      console.error('Update failed:', err);
    }
  }, [loadQueue]);

  const handleTrigger = useCallback(async (job: 'radar' | 'analyst' | 'scout') => {
    setTriggering(job);
    setTriggerResult(null);
    try {
      const res = await fetch(`/api/outreach/trigger?job=${job}`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; result?: Record<string, unknown>; error?: string };
      if (data.ok) {
        const r = data.result ?? {};
        const summary = job === 'radar'
          ? `action=${r.action} ${r.detail}`
          : job === 'analyst'
          ? `scored=${( r as {scored?:number}).scored ?? 0} dms=${(r as {dmsGenerated?:number}).dmsGenerated ?? 0} rejected=${(r as {rejected?:number}).rejected ?? 0}`
          : `found=${(r as {found?:number}).found ?? 0}${(r as {refusalReason?:string}).refusalReason ? ` (refused: ${(r as {refusalReason?:string}).refusalReason})` : ''}`;
        setTriggerResult(`✓ ${summary}`);
        await loadQueue();
      } else {
        setTriggerResult(`✗ ${data.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      setTriggerResult(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTriggering(null);
    }
  }, [loadQueue]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      color: C.text,
      fontFamily: "'DM Sans', 'Inter', -apple-system, sans-serif",
    }}>
      {/* Top nav */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: `${C.bg}e8`,
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: `linear-gradient(135deg, ${C.coral}, ${C.tangerine})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}>
            🌿
          </div>
          <span style={{ fontSize: 15, fontWeight: 700 }}>IvyLink Outreach</span>
          <span style={{
            padding: '2px 7px', background: C.badge,
            border: `1px solid ${C.border}`, borderRadius: 4,
            fontSize: 10, fontWeight: 700, color: C.textDim,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            Manual Action Center
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <span style={{ fontSize: 11, color: C.textDim }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={loadQueue}
            style={{
              padding: '5px 12px', background: C.badge, border: `1px solid ${C.border}`,
              borderRadius: 6, color: C.textMuted, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ↻ Refresh
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: '5px 12px', background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 6, color: C.textDim, fontSize: 11, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 20px' }}>

        {/* Pipeline health */}
        {health && (
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '14px 18px', marginBottom: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
          }}>
            <HealthBar health={health} />
            <div style={{ fontSize: 11, color: C.textDim }}>
              Radar running. All actions are manual.
            </div>
          </div>
        )}

        {/* Manual trigger panel */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: '12px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: C.textDim, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: 4 }}>
            Manual Trigger
          </span>
          {(['radar', 'scout', 'analyst'] as const).map((job) => (
            <button
              key={job}
              onClick={() => handleTrigger(job)}
              disabled={!!triggering}
              style={{
                padding: '5px 14px',
                background: triggering === job ? `${C.coral}22` : C.badge,
                border: `1px solid ${triggering === job ? C.coral : C.borderStrong}`,
                borderRadius: 6,
                color: triggering === job ? C.coral : C.textMuted,
                fontSize: 11, fontWeight: 600, cursor: triggering ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
            >
              {triggering === job ? `Running ${job}...` : `Run ${job}`}
            </button>
          ))}
          {triggerResult && (
            <span style={{
              fontSize: 11, fontWeight: 500,
              color: triggerResult.startsWith('✓') ? C.green : C.red,
              marginLeft: 4,
            }}>
              {triggerResult}
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 4,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: 4, marginBottom: 20,
        }}>
          {([
            { key: 'ready', label: 'Ready to Message', count: ready.length },
            { key: 'followup', label: 'Follow-ups', count: followUp.length },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '9px 16px',
                background: tab === t.key
                  ? `linear-gradient(135deg, ${C.coral}22, ${C.tangerine}11)`
                  : 'transparent',
                border: `1px solid ${tab === t.key ? C.coral + '44' : 'transparent'}`,
                borderRadius: 7,
                color: tab === t.key ? C.coral : C.textMuted,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {t.label}
              {t.count > 0 && (
                <span style={{
                  padding: '1px 7px',
                  background: tab === t.key ? C.coral : C.badge,
                  border: `1px solid ${tab === t.key ? C.coral : C.border}`,
                  borderRadius: 10, fontSize: 10, fontWeight: 800,
                  color: tab === t.key ? '#fff' : C.textMuted,
                }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.textDim }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>⟳</div>
            <div style={{ fontSize: 13 }}>Loading pipeline...</div>
          </div>
        )}

        {/* Ready queue */}
        {!loading && tab === 'ready' && (
          <>
            {ready.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '60px 0',
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 12,
              }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                  No prospects ready
                </div>
                <div style={{ fontSize: 13, color: C.textMuted }}>
                  The radar is running. Check back soon.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
                  {ready.length} prospect{ready.length !== 1 ? 's' : ''} ready — sorted by score
                </div>
                {ready.map((p) => (
                  <ProspectCard key={p.id} prospect={p} onUpdate={handleUpdate} />
                ))}
              </>
            )}
          </>
        )}

        {/* Follow-up queue */}
        {!loading && tab === 'followup' && (
          <>
            {followUp.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '60px 0',
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 12,
              }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⏰</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                  No follow-ups due
                </div>
                <div style={{ fontSize: 13, color: C.textMuted }}>
                  Follow-ups appear for prospects messaged 7+ days ago with no reply.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
                  {followUp.length} prospect{followUp.length !== 1 ? 's' : ''} due for follow-up
                </div>
                {followUp.map((p) => (
                  <FollowUpCard key={p.id} prospect={p} onUpdate={handleUpdate} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
