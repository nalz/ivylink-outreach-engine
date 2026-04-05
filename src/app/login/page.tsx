'use client';

// ============================================================
// app/login/page.tsx — Single-user admin login
// ============================================================

import { useState, useRef, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// useSearchParams() must live inside a Suspense boundary in Next.js 14
function LoginForm() {
  const router   = useRouter();
  const params   = useSearchParams();
  const next     = params.get('next') ?? '/outreach';
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const key = inputRef.current?.value ?? '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        router.push(next);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'Invalid access key');
        setLoading(false);
        inputRef.current?.focus();
      }
    } catch {
      setError('Network error. Try again.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#a1a1aa', fontWeight: 500 }}>
        Access Key
      </label>
      <input
        ref={inputRef}
        type="password"
        placeholder="Enter your access key"
        autoFocus
        autoComplete="current-password"
        disabled={loading}
        style={{
          width: '100%',
          padding: '11px 14px',
          background: '#09090b',
          border: `1px solid ${error ? '#f87171' : '#3f3f46'}`,
          borderRadius: 9,
          color: '#fafafa',
          fontSize: 14,
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color 0.15s',
        }}
        onFocus={(e) => { if (!error) e.currentTarget.style.borderColor = '#E8604A'; }}
        onBlur={(e)  => { if (!error) e.currentTarget.style.borderColor = '#3f3f46'; }}
      />
      {error && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#f87171' }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          marginTop: 20,
          padding: '12px',
          background: loading ? '#27272a' : 'linear-gradient(135deg, #E8604A, #F28B5F)',
          border: 'none',
          borderRadius: 9,
          color: loading ? '#71717a' : '#fff',
          fontSize: 14,
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'opacity 0.15s',
          letterSpacing: '0.01em',
        }}
      >
        {loading ? 'Signing in...' : 'Access Dashboard →'}
      </button>
    </form>
  );
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f0f10',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        padding: '48px 40px',
        background: '#18181b',
        borderRadius: 16,
        border: '1px solid #27272a',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 52,
            height: 52,
            background: 'linear-gradient(135deg, #E8604A, #F28B5F)',
            borderRadius: 14,
            marginBottom: 16,
            fontSize: 22,
          }}>
            🌿
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fafafa' }}>
            IvyLink Outreach
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#71717a' }}>
            Manual Action Center
          </p>
        </div>
        {children}
        <p style={{ marginTop: 28, textAlign: 'center', fontSize: 11, color: '#52525b' }}>
          Private system. Authorized access only.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <LoginShell>
      <Suspense fallback={<div style={{ color: '#52525b', fontSize: 13, textAlign: 'center' }}>Loading...</div>}>
        <LoginForm />
      </Suspense>
    </LoginShell>
  );
}
