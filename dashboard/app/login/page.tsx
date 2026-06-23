'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      window.location.href = '/';
    } else {
      setError('Password incorrecto');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white border border-line rounded-2xl p-6 shadow-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight mb-0.5">DISECTA</h1>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted mb-3">Espionaje</p>
        <p className="text-sm text-muted mb-5">Dashboard privado. Ingresa tu password.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full h-11 px-3 rounded-lg border border-line outline-none focus:border-accent mb-3"
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-60"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
