'use client';

import { ESTADOS } from '@/lib/types';

interface Props {
  stats: { total: number; porEstado: Record<string, number> } | null;
  estado: string;
  onEstado: (e: string) => void;
  section: 'contenido' | 'fuentes';
  onSection: (s: 'contenido' | 'fuentes') => void;
  mode: 'organico' | 'ads';
  onMode: (m: 'organico' | 'ads') => void;
}

export default function Sidebar({ stats, estado, onEstado, section, onSection, mode, onMode }: Props) {
  const rows: { key: string; label: string; count: number | undefined }[] = [
    { key: '', label: 'Todo', count: stats?.total },
    ...ESTADOS.map((e) => ({ key: e.key, label: e.label, count: stats?.porEstado?.[e.key] })),
  ];

  return (
    <aside className="w-56 shrink-0 border-r border-line bg-white min-h-screen px-3 py-5 hidden md:block">
      <div className="px-2 mb-5">
        <div className="text-lg font-semibold tracking-tight">DISECTA</div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Espionaje</div>
      </div>

      <div className="flex bg-gray-100 rounded-lg p-0.5 mb-5 text-sm">
        <button onClick={() => onMode('organico')} className={`flex-1 py-1.5 rounded-md ${mode === 'organico' ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}>Orgánico</button>
        <button onClick={() => onMode('ads')} className={`flex-1 py-1.5 rounded-md ${mode === 'ads' ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}>Ads</button>
      </div>

      {mode === 'organico' && (
        <>
      <div className="text-[11px] uppercase tracking-wide text-muted px-2 mb-2">Pipeline</div>
      <nav className="flex flex-col gap-0.5 mb-6">
        {rows.map((r) => {
          const active = section === 'contenido' && estado === r.key;
          return (
            <button
              key={r.key || 'all'}
              onClick={() => {
                onSection('contenido');
                onEstado(r.key);
              }}
              className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors ${
                active ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <span>{r.label}</span>
              <span className="text-xs text-muted tabular-nums">{r.count ?? '·'}</span>
            </button>
          );
        })}
      </nav>
        </>
      )}

      <div className="text-[11px] uppercase tracking-wide text-muted px-2 mb-2">Gestión</div>
      <nav className="flex flex-col gap-0.5">
        <button
          onClick={() => onSection('fuentes')}
          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors ${
            section === 'fuentes' ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-gray-50 text-gray-700'
          }`}
        >
          <span aria-hidden="true">⊕</span> Fuentes
        </button>
      </nav>
    </aside>
  );
}
