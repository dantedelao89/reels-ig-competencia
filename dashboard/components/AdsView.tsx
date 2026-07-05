'use client';

import { useCallback, useEffect, useState } from 'react';
import { ESTADOS, Estado } from '@/lib/types';
import { ESTADO_STYLE } from '@/lib/estados';
import { fmtDateShort } from '@/lib/format';
import FacetDropdown from './FacetDropdown';

export interface AdItem {
  id: string;
  adId: string;
  anunciante: string | null;
  copy: string | null;
  titulo: string | null;
  cta: string | null;
  linkDestino: string | null;
  formato: string | null;
  plataformas: string | null;
  activo: boolean | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  diasCorriendo: number | null;
  thumbnail: string | null;
  videoUrl: string | null;
  proyecto: string | null;
  estado: Estado;
  scrapeadoEn: string | null;
  miGuion: string | null;
  miNotas: string | null;
  miLink: string | null;
  miVideoUrl: string | null;
}

const PAGE_SIZE = 40;
const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' };

export default function AdsView() {
  const [stats, setStats] = useState<{ total: number; activos: number; porEstado: Record<string, number> } | null>(null);
  const [facets, setFacets] = useState<{ anunciantes: any[]; proyectos: any[] } | null>(null);
  const [estado, setEstado] = useState('');
  const [anunciantes, setAnunciantes] = useState<string[]>([]);
  const [proyectos, setProyectos] = useState<string[]>([]);
  const [activo, setActivo] = useState(''); // '', 'true', 'false'
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [sort, setSort] = useState('dias_corriendo');
  const [dir, setDir] = useState('desc');
  const [view, setView] = useState<'grid' | 'table'>('grid');

  const [items, setItems] = useState<AdItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<AdItem | null>(null);

  // Scrape individual de un anunciante (traer anuncios nuevos) desde la galería.
  const [advList, setAdvList] = useState<{ url: string; name: string; adCount: number }[]>([]);
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState('');

  const refreshStats = useCallback(() => {
    fetch('/api/ads/stats', { cache: 'no-store' }).then((r) => r.json()).then((d) => !d.error && setStats(d)).catch(() => {});
  }, []);
  const refreshFacets = useCallback(() => {
    fetch('/api/ads/facets', { cache: 'no-store' }).then((r) => r.json()).then((d) => !d.error && setFacets(d)).catch(() => {});
  }, []);
  const refreshAdvertisers = useCallback(() => {
    fetch('/api/ads/advertisers', { cache: 'no-store' }).then((r) => r.json()).then((d) => !d.error && setAdvList(d.advertisers || [])).catch(() => {});
  }, []);
  useEffect(() => {
    refreshStats();
    refreshFacets();
    refreshAdvertisers();
  }, [refreshStats, refreshFacets, refreshAdvertisers]);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (pageNum: number, replace: boolean) => {
      setLoading(true);
      const p = new URLSearchParams({ estado, q: dq, sort, dir, activo, page: String(pageNum), pageSize: String(PAGE_SIZE) });
      if (anunciantes.length) p.set('anunciante', anunciantes.join(','));
      if (proyectos.length) p.set('proyecto', proyectos.join(','));
      const data = await (await fetch(`/api/ads?${p}`, { cache: 'no-store' })).json();
      setLoading(false);
      if (data.error) return;
      setTotal(data.total);
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
    },
    [estado, dq, sort, dir, activo, anunciantes, proyectos]
  );
  useEffect(() => {
    setPage(1);
    fetchPage(1, true);
  }, [fetchPage]);

  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  async function scrapeAdvertiser() {
    if (!scrapeUrl || scraping) return;
    setScraping(true);
    setScrapeMsg('');
    try {
      const res = await fetch('/api/scrape-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scrapeUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al scrapear');
      const name = advList.find((a) => a.url === scrapeUrl)?.name || 'anunciante';
      setScrapeMsg(`✓ ${name}: ${data.inserted} anuncios nuevos`);
      // Refresca la galería para que aparezcan los nuevos sin recargar.
      refreshStats();
      refreshFacets();
      refreshAdvertisers();
      setPage(1);
      fetchPage(1, true);
    } catch (e: any) {
      setScrapeMsg('Error: ' + e.message);
    } finally {
      setScraping(false);
    }
  }

  async function setEstadoFor(ids: string[], nuevo: Estado) {
    if (!ids.length) return;
    await fetch('/api/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ids.map((id) => ({ id, platform: 'ad' })), estado: nuevo }),
    });
    setSelected(new Set());
    setDetail(null);
    refreshStats();
    fetchPage(1, true);
    setPage(1);
  }

  const estadoRows = [{ key: '', label: 'Todo', count: stats?.total }, ...ESTADOS.map((e) => ({ key: e.key, label: e.label, count: stats?.porEstado?.[e.key] }))];
  const more = items.length < total;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-medium">Pipeline Ads</h1>
          <p className="text-sm text-muted">
            {stats ? `${stats.total} anuncios · ${stats.activos} activos` : '…'}
          </p>
        </div>
        {/* Traer anuncios nuevos de un anunciante individual (solo inserta los que no tenemos). */}
        <div className="flex items-center gap-2 p-1.5 rounded-lg border border-line bg-gray-50">
          <span className="text-xs font-medium text-gray-600 pl-1">⚡ Traer nuevos de:</span>
          <select
            value={scrapeUrl}
            onChange={(e) => { setScrapeUrl(e.target.value); setScrapeMsg(''); }}
            className="h-8 text-sm rounded-md border border-line bg-white px-2 max-w-[180px]"
          >
            <option value="">— Anunciante —</option>
            {advList.map((a) => (
              <option key={a.url} value={a.url}>{a.name} ({a.adCount})</option>
            ))}
          </select>
          <button
            onClick={scrapeAdvertiser}
            disabled={!scrapeUrl || scraping}
            className="h-8 px-3 text-xs rounded-md bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scraping ? 'Scrapeando…' : 'Scrapear'}
          </button>
          {scrapeMsg && <span className="text-xs text-muted whitespace-nowrap">{scrapeMsg}</span>}
        </div>
      </div>

      {/* estado pills */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {estadoRows.map((r) => (
          <button
            key={r.key || 'all'}
            onClick={() => setEstado(r.key)}
            className={`h-8 px-3 text-xs rounded-full border ${
              estado === r.key ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line bg-white text-gray-600'
            }`}
          >
            {r.label} {r.count != null && <span className="text-muted">· {r.count}</span>}
          </button>
        ))}
      </div>

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FacetDropdown label="Anunciante" options={facets?.anunciantes || []} selected={anunciantes} onChange={setAnunciantes} />
        <FacetDropdown label="Proyecto" options={facets?.proyectos || []} selected={proyectos} onChange={setProyectos} />
        <div className="flex items-center bg-gray-100 rounded-md p-0.5 text-xs">
          {[['', 'Todos'], ['true', 'Activos'], ['false', 'Inactivos']].map(([v, l]) => (
            <button key={v} onClick={() => setActivo(v)} className={`px-2.5 h-7 rounded ${activo === v ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en copy…" className="w-full h-9 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-accent" />
        </div>
        <select value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(':'); setSort(s); setDir(d); }} className="h-9 text-sm rounded-md border border-line bg-white px-2">
          <option value="dias_corriendo:desc">Más días corriendo</option>
          <option value="fecha_inicio:desc">Más recientes</option>
          <option value="fecha_inicio:asc">Más antiguos</option>
          <option value="scrapeado_en:desc">Recién scrapeados</option>
        </select>
        <div className="flex border border-line rounded-lg overflow-hidden bg-white">
          <button onClick={() => setView('grid')} className={`px-3 h-9 text-sm ${view === 'grid' ? 'bg-gray-100' : ''}`}>▦</button>
          <button onClick={() => setView('table')} className={`px-3 h-9 text-sm border-l border-line ${view === 'table' ? 'bg-gray-100' : ''}`}>▤</button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-accent-soft">
          <span className="text-sm font-medium text-accent">{selected.size} seleccionados</span>
          <span className="flex-1" />
          <button onClick={() => setEstadoFor([...selected], 'por_curar')} className="h-8 px-3 text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-800">Por curar</button>
          <button onClick={() => setEstadoFor([...selected], 'curado')} className="h-8 px-3 text-xs rounded-md border border-line bg-white">Curado</button>
          <button onClick={() => setEstadoFor([...selected], 'descartado')} className="h-8 px-3 text-xs rounded-md border border-line bg-white">Descartar</button>
          <button onClick={() => setSelected(new Set())} className="h-8 px-3 text-xs rounded-md text-muted">Limpiar</button>
        </div>
      )}

      <div className="text-xs text-muted mb-2">{total.toLocaleString('es-MX')} resultados</div>

      {view === 'grid' ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
          {items.map((it) => {
            const sel = selected.has(it.id);
            const est = ESTADO_STYLE[it.estado];
            return (
              <div key={it.id} className={`group relative bg-white rounded-xl overflow-hidden border ${sel ? 'border-accent ring-1 ring-accent' : 'border-line'}`}>
                <button onClick={() => toggle(it.id)} className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-[5px] flex items-center justify-center text-[11px] ${sel ? 'bg-accent text-white' : 'bg-black/45 text-transparent group-hover:text-white/80'}`}>✓</button>
                <button onClick={() => setDetail(it)} className="block w-full text-left">
                  <div className="relative w-full pt-[100%] bg-gray-200">
                    {it.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.thumbnail} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    {it.videoUrl && (
                      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center text-sm">▶</span>
                    )}
                    <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">{it.activo ? '● Activo' : 'Inactivo'}</span>
                    {it.diasCorriendo != null && (
                      <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">{it.diasCorriendo}d</span>
                    )}
                  </div>
                </button>
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>
                    <span className="text-[11px] text-muted truncate ml-1">{it.anunciante}</span>
                  </div>
                  <button onClick={() => setDetail(it)} className="text-[13px] leading-snug text-left mb-2 hover:text-accent break-words w-full" style={clamp2}>
                    {it.copy || it.titulo || '(sin copy)'}
                  </button>
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    {it.cta && <span className="px-1.5 py-0.5 rounded bg-gray-100">{it.cta}</span>}
                    <span>{fmtDateShort(it.fechaInicio)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-line rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-muted text-xs">
                <th className="w-9 p-2"></th><th className="w-12 p-2"></th>
                <th className="text-left p-2">Copy</th><th className="text-left p-2 w-32">Anunciante</th>
                <th className="text-left p-2 w-16">Días</th><th className="text-left p-2 w-16">Activo</th><th className="text-left p-2 w-28">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const est = ESTADO_STYLE[it.estado];
                return (
                  <tr key={it.id} className="border-t border-line hover:bg-gray-50">
                    <td className="p-2 text-center"><input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} /></td>
                    <td className="p-2"><div className="w-9 h-9 rounded bg-gray-200 overflow-hidden">{it.thumbnail && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={it.thumbnail} alt="" className="w-full h-full object-cover" />)}</div></td>
                    <td className="p-2"><button onClick={() => setDetail(it)} className="block text-left hover:text-accent break-words" style={clamp2}>{it.copy || it.titulo || '(sin copy)'}</button></td>
                    <td className="p-2 text-muted truncate">{it.anunciante}</td>
                    <td className="p-2 tabular-nums">{it.diasCorriendo ?? '—'}</td>
                    <td className="p-2">{it.activo ? '●' : '○'}</td>
                    <td className="p-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${est.cls}`}>{est.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length === 0 && !loading && <div className="text-center text-muted text-sm py-16">Sin anuncios. Agrega anunciantes en Fuentes y corre un scrape.</div>}

      <div className="flex justify-center py-6">
        {more && <button onClick={() => { const n = page + 1; setPage(n); fetchPage(n, false); }} disabled={loading} className="h-10 px-5 text-sm rounded-lg border border-line bg-white">{loading ? 'Cargando…' : 'Cargar más'}</button>}
      </div>

      {detail && <AdDetail item={detail} onClose={() => setDetail(null)} onEstado={(e) => setEstadoFor([detail.id], e)} />}
    </div>
  );
}

function AdDetail({ item, onClose, onEstado }: { item: AdItem; onClose: () => void; onEstado: (e: Estado) => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl rounded-2xl overflow-hidden my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{item.anunciante}</span>
            <span className="text-xs text-muted shrink-0">{item.activo ? '● Activo' : 'Inactivo'} · {item.diasCorriendo ?? '—'}d</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={item.estado} onChange={(e) => onEstado(e.target.value as Estado)} className="h-8 text-sm rounded-md border border-line px-2">
              {ESTADOS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
            <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-gray-100">✕</button>
          </div>
        </div>
        <div className="grid md:grid-cols-[300px_1fr]">
          <div className="p-4 border-r border-line bg-gray-50">
            {item.videoUrl ? (
              <video src={item.videoUrl} poster={item.thumbnail || undefined} controls className="w-full rounded-lg bg-black mb-2 max-h-[60vh]" />
            ) : (
              <div className="w-full rounded-lg overflow-hidden mb-2 bg-gray-100 flex items-center justify-center">
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnail} alt="" className="w-full h-auto max-h-[60vh] object-contain" />
                ) : (
                  <div className="py-16 text-xs text-muted">sin creatividad</div>
                )}
              </div>
            )}
            {(item.thumbnail || item.videoUrl) && (
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                <a
                  href={`/api/download?url=${encodeURIComponent(item.videoUrl || item.thumbnail || '')}&name=ad_${item.adId}.${item.videoUrl ? 'mp4' : 'jpg'}`}
                  className="text-center text-xs h-8 leading-8 rounded-md border border-line bg-white hover:bg-gray-100"
                >
                  Descargar {item.videoUrl ? 'video' : 'imagen'}
                </a>
                <a
                  href={item.videoUrl || item.thumbnail || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="text-center text-xs h-8 leading-8 rounded-md border border-line bg-white hover:bg-gray-100"
                >
                  Ver completa ↗
                </a>
              </div>
            )}
            <div className="text-xs text-muted space-y-1">
              <div>Formato: {item.formato || '—'}</div>
              <div>Plataformas: {item.plataformas || '—'}</div>
              <div>Inicio: {fmtDateShort(item.fechaInicio)}</div>
              <div>Fin: {item.activo ? '(en curso)' : fmtDateShort(item.fechaFin)}</div>
              {item.proyecto && <div>Proyecto: {item.proyecto}</div>}
            </div>
          </div>
          <div className="p-4">
            {item.cta && <span className="inline-block text-xs px-2 py-1 rounded bg-accent-soft text-accent mb-3">{item.cta}</span>}
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Copy</div>
            <p className="text-sm text-gray-800 whitespace-pre-wrap mb-4">{item.copy || '(sin copy)'}</p>
            {item.linkDestino && (
              <a href={item.linkDestino} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent break-all">{item.linkDestino} ↗</a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
