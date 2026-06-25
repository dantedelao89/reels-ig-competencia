'use client';

import { useCallback, useEffect, useState } from 'react';
import { SOURCE_DEFS, SOURCE_ORDER, ADS_SOURCE_ORDER, SourceType, SourceRecord, normalizeKey } from '@/lib/sources';
import { fmtDateShort } from '@/lib/format';

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
  const [records, setRecords] = useState<SourceRecord[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [newKey, setNewKey] = useState('');
  const [newProyecto, setNewProyecto] = useState('');
  const [newNum, setNewNum] = useState('');
  const [adding, setAdding] = useState(false);
  const [scrapingId, setScrapingId] = useState('');
  const [scrapeMsg, setScrapeMsg] = useState('');

  async function scrapeOne(row: SourceRecord) {
    setScrapingId(row.id);
    setScrapeMsg('');
    setErr('');
    const endpoint = type === 'yt_channel' ? '/api/scrape-channel' : '/api/scrape-ad';
    const unidad = type === 'yt_channel' ? 'videos' : 'anuncios';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: row.key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al scrapear');
      setScrapeMsg(`✓ ${row.key.replace(/^https?:\/\/(www\.)?/, '')}: ${data.inserted} ${unidad} nuevos`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setScrapingId('');
    }
  }

  const def = SOURCE_DEFS[type];

  const load = useCallback(async (t: SourceType) => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/sources?type=${t}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRecords(data.records);
    } catch (e: any) {
      setErr(e.message);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(type);
  }, [type, load]);

  useEffect(() => {
    fetch('/api/sources/projects')
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
      setErr(`Ya existe "${key}" en ${def.label}.`);
      return;
    }
    setAdding(true);
    setErr('');
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
    } catch (e: any) {
      setErr(e.message);
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
    await fetch('/api/sources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id, ...fields }),
    }).catch(() => {});
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar esta fuente de Airtable?')) return;
    setRecords((r) => r.filter((x) => x.id !== id));
    await fetch(`/api/sources?type=${type}&id=${id}`, { method: 'DELETE' }).catch(() => {});
  }

  function projOptions(current: string | null): string[] {
    return current && !projects.includes(current) ? [current, ...projects] : projects;
  }

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-lg font-medium">Fuentes</h1>
        <p className="text-sm text-muted">
          Se guardan en Airtable (fuente única). El scraper las toma en su próxima corrida.
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
        <button
          onClick={add}
          disabled={adding || !newKey.trim()}
          className="h-9 px-4 text-sm rounded-md bg-ink text-white disabled:opacity-50"
        >
          {adding ? 'Añadiendo…' : 'Añadir'}
        </button>
      </div>

      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
      {scrapeMsg && <p className="text-sm text-green-700 mb-3">{scrapeMsg}</p>}

      {/* Lista */}
      {loading ? (
        <div className="text-sm text-muted py-10 text-center">Cargando…</div>
      ) : records.length === 0 ? (
        <div className="text-sm text-muted py-10 text-center">Sin fuentes. Añade la primera arriba.</div>
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
              {records.map((r) => (
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
                    {(type === 'fb_advertiser' || type === 'yt_channel') && (
                      <button
                        onClick={() => scrapeOne(r)}
                        disabled={scrapingId === r.id}
                        className="text-xs px-2 h-7 rounded-md border border-line bg-white hover:bg-gray-100 disabled:opacity-60 mr-1"
                        title={type === 'yt_channel' ? 'Re-scrapear este canal ahora' : 'Scrapear los anuncios de esta página ahora'}
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
