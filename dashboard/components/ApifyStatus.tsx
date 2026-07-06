'use client';

import { useCallback, useEffect, useState } from 'react';

interface AcctData {
  username: string | null;
  plan: string | null;
  current: { monthlyUsageUsd?: number } | null;
  limits: { maxMonthlyUsageUsd?: number } | null;
  monthlyCreditsUsd: number | null;
}

const money = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

// Panel privado: qué cuenta de Apify está conectada + su uso/saldo del mes. Solo lectura.
export default function ApifyStatus() {
  const [d, setD] = useState<AcctData | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    fetch('/api/apify-account', { cache: 'no-store' })
      .then((r) => r.json())
      .then((x) => (x.error ? setErr(x.error) : setD(x)))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  const usage = d?.current?.monthlyUsageUsd;
  const limit = d?.limits?.maxMonthlyUsageUsd;
  const pct = usage != null && limit ? Math.min(100, (usage / limit) * 100) : 0;
  const remaining = usage != null && limit != null ? Math.max(0, limit - usage) : null;
  const barColor = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="mt-6 rounded-lg border border-line bg-gray-50 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">Apify conectado</span>
        <button onClick={load} title="Actualizar" className="text-muted hover:text-gray-700 text-xs leading-none">
          ↻
        </button>
      </div>

      {loading && !d ? (
        <div className="text-xs text-muted">Cargando…</div>
      ) : err ? (
        <div className="text-xs text-red-600 break-words">Error: {err}</div>
      ) : d ? (
        <>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            <span className="text-sm font-medium truncate" title={d.plan || ''}>
              {d.username || '—'}
            </span>
          </div>

          {usage != null && limit != null ? (
            <>
              <div className="flex justify-between text-[11px] text-muted mb-1">
                <span>Uso del mes</span>
                <span className="tabular-nums">
                  {money(usage)} / {money(limit)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[11px] text-muted mt-1">
                Restante: <span className="font-medium text-gray-700 tabular-nums">{money(remaining)}</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted">Sin datos de uso.</div>
          )}
        </>
      ) : null}
    </div>
  );
}
