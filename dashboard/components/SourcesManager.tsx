'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SOURCE_DEFS, SOURCE_ORDER, ADS_SOURCE_ORDER, SourceType, SourceRecord, normalizeKey } from '@/lib/sources';
import { fmtDateShort } from '@/lib/format';
import { useToast } from './ui/Toast';
import { RowSkeleton } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import AsyncButton from './ui/AsyncButton';

// Desplegable de proyecto: lista los existentes + opción de escribir uno nuevo.
function ProjectSelect({
  value,
  onChange,
  projects,
}: {
  value: string;
  onChange: (v: string) => void;
  projects: string[];
}) {
  const [mode, setMode] = useState<'list' | 'new'>(value && !projects.includes(value) ? 'new' : 'list');
  if (mode === 'new') {
    return (
      <div className="flex gap-1">
        <input
          value={value}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nuevo proyecto"
          className="w-full h-9 px-2 text-sm border border-line rounded-md bg-white outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => {
            setMode('list');
            onChange('');
          }}
          className="h-9 px-2 text-xs border border-line rounded-md bg-white"
          title="Elegir existente"
        >
          ↩
        </button>
      </div>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === '__new__') {
          setMode('new');
          onChange('');
        } else onChange(e.target.value);
      }}
      className="w-full h-9 px-2 text-sm border border-line rounded-md bg-white outline-none focus:border-accent"
    >
      <option value="">— Sin proyecto —</option>
      {projects.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
      <option value="__new__">+ Nuevo proyecto…</option>
    </select>
  );
}

export default function SourcesManager({ mode = 'organico' }: { mode?: 'organico' | 'ads' }) {
  const order = mode === 'ads' ? ADS_SOURCE_ORDER : SOURCE_ORDER;
  const [type, setType] = useState<SourceType>(order[0]);
  useEffect(() => {
    setType(order[0]);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const toast = useToast();
  const keyInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<SourceRecord[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const [newKey, setNewKey] = useState('');
  const [newProyecto, setNewProyecto] = useState('');
  const [newNum, setNewNum] = useState('');
  const [adding, setAdding] = useState(false);
  const [scrapingId, setScrapingId] = useState('');
  const [filter, setFilter] = useState('');

  async function scrapeOne(row: SourceRecord) {
    setScrapingId(row.id);
    const endpoint =
      type === 'yt_channel'
        ? '/api/scrape-channel'
        : type === 'ig'
        ? '/api/scrape-creator'
        : type === 'yt_search'
        ? '/api/scrape-search'
        : '/api/scrape-ad';
    const unidad = type === 'ig' ? 'reels' : type === 'fb_advertiser' ? 'anuncios' : 'videos';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: row.key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al scrapear');
      toast.success(`${data.inserted} ${unidad} nuevos de ${row.key.replace(/^https?:\/\/(www\.)?/, '')}`);
    } catch (e: any) {
      toast.error(e.message || 'No se pudo scrapear');
    } finally {
      setScrapingId('');
    }
  }

  const def = SOURCE_DEFS[type];

  const load = useCallback(async (t: SourceType) => {
    setLoading(true);
    setLoadErr('');
    try {
      const res = await fetch(`/api/sources?type=${t}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRecords(data.records);
    } catch (e: any) {
      setLoadErr(e.message || 'No se pudo cargar');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(type);
    setFilter('');
  }, [type, load]);

  const f = filter.trim().toLowerCase();
  const shown = f
    ? records.filter((r) => r.key.toLowerCase().includes(f) || (r.proyecto || '').toLowerCase().includes(f))
    : records;

  useEffect(() => {
    fetch('/api/sources/projects', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => !d.error && setProjects(d.projects))
      .catch(() => {});
  }, []);

  function rememberProject(p: string) {
    if (p && !projects.includes(p)) setProjects((ps) => [...ps, p].sort((a, b) => a.localeCompare(b)));
  }

  async function add() {
    const key = newKey.trim();
    if (!key) return;
    // Candado anti-duplicados en el cliente (feedback inmediato).
    const norm = normalizeKey(type, key);
    if (records.some((r) => normalizeKey(type, r.key) === norm)) {
      toast.error(`Ya existe "${key}" en ${def.label}.`);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, key, proyecto: newProyecto, num: newNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al añadir');
      setRecords((r) => [data.record, ...r]);
      rememberProject(newProyecto);
      setNewKey('');
      setNewProyecto('');
      setNewNum('');
      toast.success('Fuente añadida');
    } catch (e: any) {
      toast.error(e.message || 'No se pudo añadir');
    } finally {
      setAdding(false);
    }
  }

  async function patch(id: string, fields: Partial<{ activo: boolean; proyecto: string; num: string }>) {
    setRecords((r) =>
      r.map((x) =>
        x.id === id
          ? {
              ...x,
              ...('activo' in fields ? { activo: fields.activo! } : {}),
              ...('proyecto' in fields ? { proyecto: fields.proyecto! } : {}),
              ...('num' in fields ? { num: fields.num === '' ? null : Number(fields.num) } : {}),
            }
          : x
      )
    );
    if ('proyecto' in fields) rememberProject(fields.proyecto!);
    try {
      const res = await fetch('/api/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, ...fields }),
      });
      if (!res.ok) throw new Error('No se pudo guardar el cambio');
    } catch (e: any) {
      toast.error(e.message || 'No se pudo guardar');
      load(type); // revierte el cambio optimista releyendo del servidor
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar esta fuente?')) return;
    const prev = records;
    setRecords((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/sources?type=${type}&id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo eliminar');
      toast.success('Fuente eliminada');
    } catch (e: any) {
      setRecords(prev); // restaura si falló
      toast.error(e.message || 'No se pudo eliminar');
    }
  }

  function projOptions(current: string | null): string[] {
    return current && !projects.includes(current) ? [current, ...projects] : projects;
  }

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-lg font-medium">Fuentes</h1>
        <p className="text-sm text-muted">
          Se guardan en Supabase (fuente única). El scraper las toma en su próxima corrida.
        </p>
      </div>

      <div className="flex gap-1 border-b border-line mt-4 mb-4">
        {order.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-3 h-9 text-sm rounded-t-md -mb-px border-b-2 ${
              type === t ? 'border-accent text-accent font-medium' : 'border-transparent text-muted hover:text-gray-700'
            }`}
          >
            {SOURCE_DEFS[t].label}
          </button>
        ))}
      </div>

      {/* Añadir */}
      <div className="flex flex-wrap items-end gap-2 bg-gray-50 border border-line rounded-lg p-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted block mb-1">{def.keyLabel}</label>
          <input
            ref={keyInputRef}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={def.keyPlaceholder}
            className="w-full h-9 px-2 text-sm border border-line rounded-md bg-white outline-none focus:border-accent"
          />
        </div>
        <div className="w-44">
          <label className="text-xs text-muted block mb-1">Proyecto</label>
          <ProjectSelect value={newProyecto} onChange={setNewProyecto} projects={projects} />
        </div>
        <div className="w-28">
          <label className="text-xs text-muted block mb-1">{type === 'ig' ? 'Reels' : 'Videos'}/corrida</label>
          <input
            value={newNum}
            onChange={(e) => setNewNum(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="auto"
            className="w-full h-9 px-2 text-sm border border-line rounded-md bg-white outline-none focus:border-accent"
          />
        </div>
        <AsyncButton onClick={add} disabled={!newKey.trim()} loading={adding} loadingLabel="Añadiendo…">
          Añadir
        </AsyncButton>
      </div>

      {/* Buscador */}
      {records.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">⌕</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Buscar en ${def.label.toLowerCase()}…`}
              className="w-full h-9 pl-8 pr-3 text-sm border border-line rounded-md bg-white outline-none focus:border-accent"
            />
          </div>
          <span className="text-xs text-muted">
            {f ? `${shown.length} de ${records.length}` : `${records.length}`}
          </span>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="border border-line rounded-lg overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} columns={5} />
          ))}
        </div>
      ) : loadErr ? (
        <ErrorState message={loadErr} onRetry={() => load(type)} />
      ) : records.length === 0 ? (
        <EmptyState
          icon="➕"
          title={`Aún no tienes ${def.label.toLowerCase()}`}
          description="Agrega la primera fuente para que el scraper la incluya en la próxima corrida."
          actionLabel="Agregar la primera"
          onAction={() => keyInputRef.current?.focus()}
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="🔍" title={`Nada coincide con “${filter}”`} description="Prueba con otro término." />
      ) : (
        <div className="border border-line rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-muted text-xs">
                <th className="text-left p-2 w-20">Activo</th>
                <th className="text-left p-2">{def.keyLabel}</th>
                <th className="text-left p-2 w-44">Proyecto</th>
                <th className="text-left p-2 w-24">{type === 'ig' ? 'Reels' : 'Videos'}</th>
                <th className="text-left p-2 w-28">Última corrida</th>
                <th className="p-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-line hover:bg-gray-50">
                  <td className="p-2">
                    <button
                      onClick={() => patch(r.id, { activo: !r.activo })}
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        r.activo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {r.activo ? 'Activo' : 'Pausado'}
                    </button>
                  </td>
                  <td className="p-2 font-medium break-all">{r.key}</td>
                  <td className="p-2">
                    <select
                      value={r.proyecto || ''}
                      onChange={(e) => patch(r.id, { proyecto: e.target.value })}
                      className="w-full h-8 px-1.5 text-xs border border-transparent hover:border-line focus:border-accent rounded outline-none bg-transparent"
                    >
                      <option value="">—</option>
                      {projOptions(r.proyecto).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      defaultValue={r.num ?? ''}
                      onBlur={(e) =>
                        String(e.target.value) !== String(r.num ?? '') &&
                        patch(r.id, { num: e.target.value.replace(/[^0-9]/g, '') })
                      }
                      placeholder="auto"
                      className="w-16 h-7 px-1.5 text-xs border border-transparent hover:border-line focus:border-accent rounded outline-none bg-transparent"
                    />
                  </td>
                  <td className="p-2 text-muted whitespace-nowrap">
                    {r.ultimaCorrida ? fmtDateShort(r.ultimaCorrida) : 'nunca'}
                  </td>
                  <td className="p-2 text-center whitespace-nowrap">
                    {(type === 'fb_advertiser' || type === 'yt_channel' || type === 'ig' || type === 'yt_search') && (
                      <button
                        onClick={() => scrapeOne(r)}
                        disabled={scrapingId === r.id}
                        className="text-xs px-2 h-7 rounded-md border border-line bg-white hover:bg-gray-100 disabled:opacity-60 mr-1"
                        title={
                          type === 'yt_channel'
                            ? 'Re-scrapear este canal ahora'
                            : type === 'ig'
                            ? 'Re-scrapear los reels de este creador ahora'
                            : type === 'yt_search'
                            ? 'Buscar videos recientes de esta palabra clave ahora'
                            : 'Scrapear los anuncios de esta página ahora'
                        }
                      >
                        {scrapingId === r.id ? 'Scrapeando…' : '⚡ Scrapear'}
                      </button>
                    )}
                    <button onClick={() => remove(r.id)} className="text-muted hover:text-red-600" title="Eliminar">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
