'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * Simple account registration page (dev-friendly).
 *
 * This UI is intentionally lightweight:
 * - Collects name and email and "registers" by synthesizing a demo token.
 * - Calls AuthProvider.login() to establish session locally.
 *
 * Replace this with a real OIDC / registration flow for production.
 */

export default function RegisterPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [persist, setPersist] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);

    if (!email || !name) {
      setError('Please provide name and email');
      return;
    }

    setLoading(true);
    try {
      // In dev, synthesize a token and log the user in locally.
      // In prod, call your backend /auth/register or OIDC flow.
      const demoToken = `demo-token:${email}:${Date.now()}`;
      const user = { id: `user:${email}`, email, name, roles: ['buyer'] };

      // Simulate small latency
      await new Promise((r) => setTimeout(r, 400));

      login(demoToken, user, persist);
      // Navigate to marketplace after registration
      router.push('/marketplace');
    } catch (err: any) {
      setError(String(err?.message || err || 'Registration failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="max-w-xl mx-auto">
        <div className="card">
          <h2 className="text-2xl font-heading font-bold mb-2">Create your account</h2>
          <p className="text-sm text-muted mb-4">Register to buy and manage licenses. This demo performs a local registration only.</p>

          <form onSubmit={handleRegister} className="space-y-4">
            <label className="block">
              <div className="text-sm font-medium">Full name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" placeholder="Jane Doe" />
            </label>

            <label className="block">
              <div className="text-sm font-medium">Email</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" placeholder="you@example.com" />
            </label>

            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
              <span className="text-sm text-muted">Remember me on this device</span>
            </label>

            {error && <div className="text-red-600">{error}</div>}

            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setName('');
                  setEmail('');
                  setError(null);
                }}
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

