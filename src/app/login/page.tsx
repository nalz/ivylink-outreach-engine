'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
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
        // Get the ?next= param or default to /outreach
        const params = new URLSearchParams(window.location.search);
        window.location.replace(params.get('next') ?? '/outreach');
      } else {
        setError('Invalid key. Try again.');
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f0f0f',
      fontFamily: "'DM Sans', 'Inter', -apple-system, sans-serif",
    }}>
      <div style={{
        width: 360,
        padding: '40px 32px',
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        borderRadius: 12,
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
            IvyLink Outreach
          </div>
          <div style={{ fontSize: 13, color: '#888' }}>
            Enter your admin key to continue
          </div>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <input
              type="password"
              placeholder="Admin key"
              value={key}
              onChange={e => setKey(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#111',
                border: '1px solid #333',
                borderRadius: 7,
                color: '#fff',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{ marginBottom: 14, fontSize: 12, color: '#e55', padding: '8px 10px', background: '#e551', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !key.trim()}
            style={{
              width: '100%',
              padding: '10px',
              background: loading || !key.trim() ? '#333' : '#E8604A',
              color: loading || !key.trim() ? '#666' : '#fff',
              border: 'none',
              borderRadius: 7,
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || !key.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
