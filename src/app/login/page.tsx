'use client';

// ============================================================
// src/app/login/page.tsx — IvyLink Admin Login
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const C = {
  bg: '#0c0c0d',
  surface: '#141416',
  border: '#232326',
  borderStrong: '#2e2e32',
  coral: '#E8604A',
  tangerine: '#F28B5F',
  text: '#f0f0f0',
  textMuted: '#7a7a80',
  textDim: '#4a4a50',
  red: '#f87171',
  badge: '#1e1e22',
};

export default function LoginPage() {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });

      if (res.ok) {
        router.replace('/outreach');
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Invalid access key');
      }
    } catch {
      setError('Connection error — try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Sans', 'Inter', -apple-system, sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: 380,
        padding: '0 20px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.coral}, ${C.tangerine})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>
            🌿
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>IvyLink Outreach</div>
            <div style={{ fontSize: 11, color: C.textDim }}>Manual Action Center</div>
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '28px 24px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
            Enter access key
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 20 }}>
            Set via UI_ADMIN_KEY in Railway environment variables.
          </div>

          <form onSubmit={handleSubmit}>
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Access key"
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                background: C.bg,
                border: `1px solid ${error ? C.red : C.borderStrong}`,
                borderRadius: 8,
                color: C.text,
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: error ? 8 : 16,
              }}
            />

            {error && (
              <div style={{
                fontSize: 12, color: C.red,
                marginBottom: 12, padding: '6px 10px',
                background: `${C.red}11`,
                border: `1px solid ${C.red}33`,
                borderRadius: 6,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !key.trim()}
              style={{
                width: '100%',
                padding: '10px',
                background: loading || !key.trim() ? C.badge : C.coral,
                border: `1px solid ${loading || !key.trim() ? C.border : C.coral}`,
                borderRadius: 8,
                color: loading || !key.trim() ? C.textDim : '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: loading || !key.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
