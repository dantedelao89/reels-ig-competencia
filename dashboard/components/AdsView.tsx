'use client';

import { useCallback, useEffect, useState } from 'react';
import { ESTADOS, Estado } from '@/lib/types';
import { ESTADO_STYLE } from '@/lib/estados';
import { fmtDateShort, toParagraphs } from '@/lib/format';
import FacetDropdown from './FacetDropdown';
import { useToast } from './ui/Toast';
import { useActivity } from './ui/Activity';
import { CardGridSkeleton } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import AsyncButton from './ui/AsyncButton';
import Spinner from './ui/Spinner';

export interface AdItem {
  id: string;
  adId: string;
  anunciante: string | null;
  paginaUrl: string | null;
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

// Texto de anuncios dinámicos (catálogo) a veces trae el merge-tag sin rellenar (ej. "{{product.brand}}")
// cuando Meta no lo resolvió fuera de su contexto original. Mostramos un fallback en vez del placeholder roto.
function cleanAdText(text: string | null, fallback: string): string {
  const t = (text || '').trim();
  if (!t || /^\{\{.*\}\}$/.test(t)) return fallback;
  return t;
}

interface AdsViewProps {
  estado: string; // el filtro de pipeline vive en el sidebar (DashboardClient), llega como prop
  stats: { total: number; activos: number; porEstado: Record<string, number> } | null;
  onStatsChange: () => void; // refresca los conteos del sidebar tras un scrape / cambio de estado
}

export default function AdsView({ estado, stats, onStatsChange }: AdsViewProps) {
  const [facets, setFacets] = useState<{ anunciantes: any[]; proyectos: any[] } | null>(null);
  const [anunciantes, setAnunciantes] = useState<string[]>([]);
  const [proyectos, setProyectos] = useState<string[]>([]);
  const [activo, setActivo] = useState(''); // '', 'true', 'false'
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  // Default: recién scrapeados primero → lo que acabas de scrapear aparece arriba.
  const [sort, setSort] = useState('scrapeado_en');
  const [dir, setDir] = useState('desc');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [items, setItems] = useState<AdItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false); // ya llegó al menos una respuesta OK (para skeleton inicial)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<AdItem | null>(null);
  const toast = useToast();
  const activity = useActivity();

  // Agregar/scrapear un anunciante pegando cualquier link de Facebook (post, anuncio, página).
  // Si ya existe, solo trae sus anuncios nuevos (dedup); si no, lo da de alta en Fuentes.
  const [adUrl, setAdUrl] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);

  const refreshFacets = useCallback(() => {
    fetch('/api/ads/facets', { cache: 'no-store' }).then((r) => r.json()).then((d) => !d.error && setFacets(d)).catch(() => {});
  }, []);
  useEffect(() => {
    refreshFacets();
  }, [refreshFacets]);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (pageNum: number, replace: boolean) => {
      setLoading(true);
      if (replace) setLoadError(null);
      try {
        const p = new URLSearchParams({ estado, q: dq, sort, dir, activo, page: String(pageNum), pageSize: String(PAGE_SIZE) });
        if (anunciantes.length) p.set('anunciante', anunciantes.join(','));
        if (proyectos.length) p.set('proyecto', proyectos.join(','));
        const res = await fetch(`/api/ads?${p}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `Error ${res.status}`);
        setTotal(data.total);
        setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
        setLoaded(true);
      } catch (e: any) {
        if (replace) setLoadError(e?.message || 'No se pudo cargar');
      } finally {
        setLoading(false);
      }
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

  async function addAdvertiserByUrl() {
    const u = adUrl.trim();
    if (!u || addingUrl) return;
    setAddingUrl(true);
    const doneAct = activity.begin(`Scrapeando anuncio: ${u.slice(0, 40)}…`);
    try {
      const res = await fetch('/api/scrape-ad-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Error al agregar');
      let msg: string;
      if (data.message && data.inserted === 0) msg = data.message;
      else if (data.unico) msg = data.inserted > 0 ? 'Video agregado' : 'Ese video ya estaba en la base';
      else msg = `${data.inserted} anuncios nuevos${data.anuncianteNuevo ? ' (anunciante nuevo)' : ''}`;
      toast.success(msg);
      setAdUrl('');
      onStatsChange();
      refreshFacets();
      setPage(1);
      fetchPage(1, true);
    } catch (e: any) {
      toast.error(e.message || 'No se pudo agregar');
    } finally {
      setAddingUrl(false);
      doneAct();
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
    onStatsChange();
    fetchPage(1, true);
    setPage(1);
  }

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
      </div>

      {/* toolbar: buscador + Filtros (anunciante/proyecto/activo/orden) + vista. El pipeline vive
          en el sidebar (igual que Orgánico), así no hay dos sistemas de filtrado compitiendo. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en copy…" className="w-full h-9 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-accent" />
        </div>

        <div className="relative">
          {(() => {
            const activeFilters = anunciantes.length + proyectos.length + (activo ? 1 : 0);
            return (
              <button
                onClick={() => setFiltersOpen((o) => !o)}
                className={`h-9 px-3 text-sm rounded-lg border inline-flex items-center gap-1.5 ${
                  activeFilters > 0 ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-gray-700'
                }`}
              >
                Filtros {activeFilters > 0 && <span className="font-medium">· {activeFilters}</span>} <span className="text-[10px]">▾</span>
              </button>
            );
          })()}
          {filtersOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setFiltersOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 w-80 bg-white border border-line rounded-xl shadow-lg p-3 space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Anunciante</div>
                  <FacetDropdown label="Anunciante" options={facets?.anunciantes || []} selected={anunciantes} onChange={setAnunciantes} />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Proyecto</div>
                  <FacetDropdown label="Proyecto" options={facets?.proyectos || []} selected={proyectos} onChange={setProyectos} />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Estado en Meta</div>
                  <div className="flex items-center bg-gray-100 rounded-md p-0.5 text-xs w-fit">
                    {[['', 'Todos'], ['true', 'Activos'], ['false', 'Inactivos']].map(([v, l]) => (
                      <button key={v} onClick={() => setActivo(v)} className={`px-2.5 h-7 rounded ${activo === v ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Orden visible (separado de Filtros: ordenar ≠ filtrar). Default = Recién scrapeados. */}
        <select
          value={`${sort}:${dir}`}
          onChange={(e) => { const [s, d] = e.target.value.split(':'); setSort(s); setDir(d); }}
          className="h-9 text-sm rounded-lg border border-line bg-white px-2 text-gray-700"
        >
          <option value="scrapeado_en:desc">Recién scrapeados</option>
          <option value="fecha_inicio:desc">Más recientes</option>
          <option value="fecha_inicio:asc">Más antiguos</option>
          <option value="dias_corriendo:desc">Más días corriendo</option>
        </select>

        <div className="flex border border-line rounded-lg overflow-hidden bg-white">
          <button onClick={() => setView('grid')} className={`px-3 h-9 text-sm ${view === 'grid' ? 'bg-gray-100' : ''}`}>▦</button>
          <button onClick={() => setView('table')} className={`px-3 h-9 text-sm border-l border-line ${view === 'table' ? 'bg-gray-100' : ''}`}>▤</button>
        </div>
      </div>

      {/* Barra fija "Agregar por URL" (mismo patrón que Orgánico): pega cualquier link de Facebook
          — si el anunciante ya existe, trae sus anuncios nuevos; si no, lo da de alta en Fuentes. */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-2.5 rounded-lg border border-line bg-gray-50">
        <span className="text-xs font-medium text-gray-600 shrink-0">⚡ Agregar / scrapear por URL:</span>
        <input
          value={adUrl}
          onChange={(e) => setAdUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addAdvertiserByUrl()}
          placeholder="Link de un anuncio, post o página de Facebook"
          className="flex-1 min-w-[220px] h-9 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-accent"
        />
        <AsyncButton
          onClick={addAdvertiserByUrl}
          disabled={!adUrl.trim()}
          loading={addingUrl}
          loadingLabel="Agregando…"
        >
          Agregar
        </AsyncButton>
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

      {loadError && items.length === 0 ? (
        <ErrorState message={loadError} onRetry={() => fetchPage(1, true)} />
      ) : !loaded ? (
        <CardGridSkeleton count={12} variant="ad" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📢"
          title="Sin anuncios"
          description="Pega el link de un anuncio o página de Facebook en la barra de arriba, o agrega anunciantes en Fuentes."
        />
      ) : (
      <>
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
                    {it.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.thumbnail} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    ) : it.videoUrl ? (
                      // Anuncios de video sin thumbnail (bovi no da preview): usamos el primer frame
                      // del video (R2). preload=metadata + #t fuerza a pintar ese frame como portada.
                      <video
                        src={`${it.videoUrl}#t=0.5`}
                        muted
                        playsInline
                        preload="metadata"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : null}
                    {it.videoUrl && (
                      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center text-sm">▶</span>
                    )}
                    <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">{it.activo ? '● Activo' : 'Inactivo'}</span>
                    {it.diasCorriendo != null && (
                      <span title={`${it.diasCorriendo} días corriendo`} className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">{it.diasCorriendo}d</span>
                    )}
                  </div>
                </button>
                <div className="p-2.5">
                  <div className="flex items-center justify-between mb-1.5 gap-1">
                    <span className="text-[13px] font-medium truncate">{cleanAdText(it.anunciante, 'Anunciante')}</span>
                    <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>
                  </div>
                  <button onClick={() => setDetail(it)} className="text-[13px] leading-snug text-left mb-2 hover:text-accent break-words w-full text-muted" style={clamp2}>
                    {cleanAdText(it.copy || it.titulo, '(sin copy)')}
                  </button>
                  <div className="text-[11px] text-muted">{fmtDateShort(it.fechaInicio)}</div>
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
                    <td className="p-2"><div className="w-9 h-9 rounded bg-gray-200 overflow-hidden">{it.thumbnail ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={it.thumbnail} alt="" className="w-full h-full object-cover" />) : it.videoUrl ? (<video src={`${it.videoUrl}#t=0.5`} muted playsInline preload="metadata" className="w-full h-full object-cover" />) : null}</div></td>
                    <td className="p-2"><button onClick={() => setDetail(it)} className="block text-left hover:text-accent break-words" style={clamp2}>{cleanAdText(it.copy || it.titulo, '(sin copy)')}</button></td>
                    <td className="p-2 text-muted truncate">{cleanAdText(it.anunciante, '—')}</td>
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

      <div className="flex justify-center py-6">
        {more && <button onClick={() => { const n = page + 1; setPage(n); fetchPage(n, false); }} disabled={loading} className="h-10 px-5 text-sm rounded-lg border border-line bg-white">{loading ? 'Cargando…' : 'Cargar más'}</button>}
      </div>
      </>
      )}

      {detail && (
        <AdDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEstado={(e) => setEstadoFor([detail.id], e)}
          onRescraped={() => {
            onStatsChange();
            setPage(1);
            fetchPage(1, true);
          }}
        />
      )}
    </div>
  );
}

function AdDetail({ item, onClose, onEstado, onRescraped }: { item: AdItem; onClose: () => void; onEstado: (e: Estado) => void; onRescraped: () => void }) {
  const toast = useToast();
  const activity = useActivity();
  const [rescraping, setRescraping] = useState(false);

  // Re-scrapea a este anunciante para traer sus anuncios nuevos (misma lógica del botón de Fuentes).
  async function rescrape() {
    if (!item.paginaUrl || rescraping) return;
    setRescraping(true);
    const doneAct = activity.begin(`Buscando anuncios nuevos: ${cleanAdText(item.anunciante, 'anunciante')}…`);
    try {
      const res = await fetch('/api/ads/rescrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paginaUrl: item.paginaUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'No se pudo re-scrapear');
      toast.success(data.inserted > 0 ? `${data.inserted} anuncios nuevos` : 'Sin anuncios nuevos');
      if (data.inserted > 0) onRescraped();
    } catch (e: any) {
      toast.error(e.message || 'No se pudo re-scrapear');
    } finally {
      setRescraping(false);
      doneAct();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl rounded-2xl overflow-hidden my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{cleanAdText(item.anunciante, 'Anunciante')}</span>
            <span className="text-xs text-muted shrink-0">{item.activo ? '● Activo' : 'Inactivo'} · {item.diasCorriendo ?? '—'}d</span>
          </div>
          <div className="flex items-center gap-2">
            {item.paginaUrl && (
              <AsyncButton onClick={rescrape} loading={rescraping} loadingLabel="Buscando…" variant="secondary">
                🔄 Buscar anuncios nuevos
              </AsyncButton>
            )}
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
            <p className="text-sm text-gray-800 whitespace-pre-wrap mb-4">{cleanAdText(item.copy, '(sin copy)')}</p>
            {item.linkDestino && (
              <a href={item.linkDestino} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent break-all mb-4">{item.linkDestino} ↗</a>
            )}

            {/* Transcripción del video del anuncio (mismo flujo que Orgánico). */}
            {item.videoUrl && <AdTranscription item={item} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// Transcripción + traducción del video de un anuncio. Carga la existente al abrir; si no hay,
// ofrece transcribir con IA (baja el audio del video en R2 y lo transcribe). Espejo de DetailModal.
function AdTranscription({ item }: { item: AdItem }) {
  const toast = useToast();
  const activity = useActivity();
  const [transcripcion, setTranscripcion] = useState('');
  const [traduccion, setTraduccion] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [loadingTr, setLoadingTr] = useState(true);
  const [transcribing, setTranscribing] = useState(false);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingTr(true);
    setTranscripcion('');
    setTraduccion('');
    setShowTranslation(false);
    fetch(`/api/item?platform=ad&id=${item.id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive || d.error) return;
        if (d.transcripcion) setTranscripcion(d.transcripcion);
        if (d.traduccion) { setTraduccion(d.traduccion); setShowTranslation(true); }
      })
      .catch(() => {})
      .finally(() => alive && setLoadingTr(false));
    return () => { alive = false; };
  }, [item.id]);

  async function transcribe() {
    setTranscribing(true);
    const doneAct = activity.begin(`Transcribiendo anuncio${item.anunciante ? `: ${item.anunciante}` : ''}…`);
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'ad', id: item.id, url: item.videoUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Falló la transcripción');
      setTranscripcion(data.text);
      toast.success('Transcripción lista');
    } catch (e: any) {
      toast.error(e.message || 'Falló la transcripción');
    } finally {
      setTranscribing(false);
      doneAct();
    }
  }

  async function translate() {
    setTranslating(true);
    const doneAct = activity.begin('Traduciendo transcripción…');
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'ad', id: item.id, text: transcripcion }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Falló la traducción');
      setTraduccion(data.text);
      setShowTranslation(true);
    } catch (e: any) {
      toast.error(e.message || 'Falló la traducción');
    } finally {
      setTranslating(false);
      doneAct();
    }
  }

  return (
    <div className="mt-2 border-t border-line pt-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">Transcripción</span>
        <div className="flex items-center gap-3 text-xs">
          {transcripcion && !transcribing && (
            traduccion ? (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowTranslation(false)} className={!showTranslation ? 'text-accent font-medium' : 'text-muted hover:text-gray-700'}>Original</button>
                <span className="text-line">·</span>
                <button onClick={() => setShowTranslation(true)} className={showTranslation ? 'text-accent font-medium' : 'text-muted hover:text-gray-700'}>Español</button>
              </div>
            ) : (
              <button onClick={translate} disabled={translating} className="text-muted hover:text-accent disabled:opacity-50">
                {translating ? 'Traduciendo…' : '🌐 Traducir'}
              </button>
            )
          )}
          {transcripcion && !transcribing && (
            <button onClick={transcribe} className="text-muted hover:text-accent">↻ Re-transcribir</button>
          )}
        </div>
      </div>

      {transcribing ? (
        <div className="flex flex-col items-center justify-center text-center py-8 text-muted">
          <Spinner size={20} />
          <div className="text-sm font-medium text-gray-700 mt-2">Transcribiendo con IA…</div>
          <div className="text-xs mt-1">Baja el audio del video y lo transcribe. Tarda ~1–2 min.</div>
        </div>
      ) : transcripcion ? (
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {toParagraphs(showTranslation && traduccion ? traduccion : transcripcion).map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-gray-800">{p}</p>
          ))}
        </div>
      ) : loadingTr ? (
        <div className="text-xs text-muted py-4">Cargando…</div>
      ) : (
        <div className="text-center py-4">
          <p className="text-xs text-muted mb-3">Este anuncio aún no tiene transcripción.</p>
          <AsyncButton onClick={transcribe} loading={transcribing} loadingLabel="Transcribiendo…">
            ✨ Transcribir con IA
          </AsyncButton>
        </div>
      )}
    </div>
  );
}
