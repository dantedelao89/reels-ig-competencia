'use client';

// Radar: lo que traen las consultas guardadas de X, agrupado por día.
//
// No es la galería. Aquí no se cura ni se archiva nada: es una bandeja de descubrimiento en la que
// cada hallazgo se juzga una vez. Lo bueno se PROMUEVE (su autor entra a Fuentes y a partir de ahí
// se scrapea y archiva como cualquier cuenta), lo demás se descarta y desaparece de la vista.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtDiaRel, fmtHora, fmtNum } from '@/lib/format';
import { useToast } from './ui/Toast';
import { useActivity } from './ui/Activity';
import AsyncButton from './ui/AsyncButton';
import Spinner from './ui/Spinner';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import SearchSelect from './ui/SearchSelect';

interface RespuestaAutor { id: string; texto: string; url: string | null }

interface Hallazgo {
  id: string;
  postId: string;
  busquedaId: string | null;
  busqueda: string | null;
  creador: string | null;
  creadorNombre: string | null;
  seguidores: number | null;
  url: string | null;
  caption: string | null;
  respuestasAutor: RespuestaAutor[] | null;
  fechaPublicacion: string | null;
  dia: string;
  views: number | null;
  likes: number | null;
  comentarios: number | null;
  retweets: number | null;
  tipo: string | null;
  hashtags: string | null;
  linksExternos: string | null;
  thumbnail: string | null;
  promovido: boolean;
  descartado: boolean;
}

const RANGOS = [
  { key: '1', label: 'Hoy' },
  { key: '3', label: '3 días' },
  { key: '7', label: '7 días' },
  { key: '', label: 'Todo' },
];

// El radar trae mucho ruido por diseño: el umbral es la herramienta principal para leerlo.
const UMBRALES = [
  { key: '0', label: 'Todo' },
  { key: '50', label: '+50 ❤️' },
  { key: '200', label: '+200 ❤️' },
  { key: '1000', label: '+1000 ❤️' },
];

const PAGE_SIZE = 200;

function desdeHace(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(
    new Date(Date.now() - (dias - 1) * 86_400_000)
  );
}

export default function RadarView() {
  const toast = useToast();
  const activity = useActivity();

  const [busquedas, setBusquedas] = useState<{ id: string; key: string; name: string | null }[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [rango, setRango] = useState('7');
  const [minLikes, setMinLikes] = useState('50');
  const [q, setQ] = useState('');
  const [verDescartados, setVerDescartados] = useState(false);
  const [items, setItems] = useState<Hallazgo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [actuando, setActuando] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sources?type=x_search', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.records)) {
          setBusquedas(d.records.map((r: any) => ({ id: r.id, key: r.key, name: r.name })));
        }
      })
      .catch(() => {});
  }, []);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (busqueda) params.set('busqueda', busqueda);
    if (rango) params.set('desde', desdeHace(Number(rango)));
    if (minLikes !== '0') params.set('minLikes', minLikes);
    if (q.trim()) params.set('q', q.trim());
    if (verDescartados) params.set('descartados', '1');
    setError(null);
    try {
      const res = await fetch(`/api/radar?${params}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `Error ${res.status}`);
      setItems(d.items);
      setTotal(d.total);
      setLoaded(true);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar');
    } finally {
      setLoading(false);
    }
  }, [busqueda, rango, minLikes, q, verDescartados]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  async function correrRadar() {
    if (corriendo) return;
    setCorriendo(true);
    const doneAct = activity.begin('Corriendo el radar de X…');
    try {
      const res = await fetch('/api/radar-x', { method: 'POST' });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo correr');
      if (!d.consultas) toast.info('No hay consultas activas. Agrégalas en Fuentes → Búsquedas X.');
      else toast.success(`${d.nuevos} hallazgos nuevos de ${d.consultas} consulta(s)`);
      // La señal de cada consulta se reporta aquí: es lo que deja ver cuáles rinden.
      (d.details || []).forEach((x: any) => {
        if (x.error) toast.error(`"${x.busqueda}": ${x.error}`);
        else if (x.traidos && x.flojos / x.traidos > 0.6) {
          toast.info(`"${x.busqueda}": ${x.flojos} de ${x.traidos} con menos de 10 ❤️ — consulta poco selectiva`);
        }
      });
      fetchPage();
    } catch (e: any) {
      toast.error(e.message || 'No se pudo correr el radar');
    } finally {
      setCorriendo(false);
      doneAct();
    }
  }

  async function accion(h: Hallazgo, acc: 'promover' | 'descartar' | 'restaurar') {
    if (actuando) return;
    setActuando(h.id);
    try {
      const res = await fetch('/api/radar/accion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: h.id, accion: acc }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo');
      if (acc === 'promover') {
        toast.success(
          d.yaEstaba ? `@${d.handle} ya estaba en Fuentes` : `@${d.handle} añadido a Fuentes → Cuentas X`
        );
      }
      // Descartar lo saca de la vista; promover solo lo marca, para poder seguir leyéndolo.
      setItems((prev) =>
        acc === 'descartar' && !verDescartados
          ? prev.filter((x) => x.id !== h.id)
          : prev.map((x) => (x.id === h.id ? { ...x, promovido: acc === 'promover' || x.promovido, descartado: acc === 'descartar' } : x))
      );
    } catch (e: any) {
      toast.error(e.message || 'No se pudo');
    } finally {
      setActuando(null);
    }
  }

  const dias = useMemo(() => {
    const map = new Map<string, Hallazgo[]>();
    for (const h of items) {
      const k = h.dia || 'sin fecha';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(h);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold tracking-tight mr-1">📡 Radar</h2>

        <SearchSelect
          value={busqueda}
          onChange={setBusqueda}
          options={busquedas.map((b) => ({ value: b.id, label: b.name || b.key }))}
          emptyLabel="Todas las consultas"
          placeholder="Buscar consulta…"
        />

        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
          {RANGOS.map((r) => (
            <button
              key={r.key}
              onClick={() => setRango(r.key)}
              className={`px-2.5 py-1.5 rounded-md ${rango === r.key ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs" title="El radar trae ruido por diseño: sube el umbral para leerlo">
          {UMBRALES.map((u) => (
            <button
              key={u.key}
              onClick={() => setMinLikes(u.key)}
              className={`px-2.5 py-1.5 rounded-md ${minLikes === u.key ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}
            >
              {u.label}
            </button>
          ))}
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en el texto…"
          className="h-8 px-2.5 text-sm rounded-lg border border-line bg-white outline-none focus:border-accent w-44"
        />

        <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
          <input type="checkbox" checked={verDescartados} onChange={(e) => setVerDescartados(e.target.checked)} />
          Ver descartados
        </label>

        <span className="flex-1" />
        <span className="text-xs text-muted tabular-nums">{total} hallazgos</span>

        <AsyncButton onClick={correrRadar} loading={corriendo} loadingLabel="Rastreando…" title="Correr todas las consultas activas de X">
          📡 Rastrear ahora
        </AsyncButton>
      </div>

      {error && !items.length ? (
        <ErrorState message={error} onRetry={fetchPage} />
      ) : !loaded ? (
        <div className="flex justify-center py-16"><Spinner size={22} /></div>
      ) : !items.length ? (
        <EmptyState
          icon="📡"
          title="El radar está vacío"
          description={
            busquedas.length
              ? 'No hay hallazgos con estos filtros. Baja el umbral de likes, amplía el rango o rastrea ahora.'
              : 'Primero agrega consultas en Fuentes → Búsquedas X. Una consulta con operadores (min_faves:300, lang:es) rinde mucho más que un hashtag suelto.'
          }
          actionLabel={busquedas.length ? 'Rastrear ahora' : undefined}
          onAction={busquedas.length ? correrRadar : undefined}
        />
      ) : (
        <>
          {loading && <div className="flex justify-center py-2"><Spinner size={16} /></div>}
          {dias.map(([dia, delDia]) => (
            <section key={dia} className="mb-6">
              <div className="flex items-baseline gap-2 mb-2">
                <h3 className="text-sm font-semibold capitalize">{fmtDiaRel(dia)}</h3>
                <span className="text-xs text-muted">
                  {delDia.length} {delDia.length === 1 ? 'hallazgo' : 'hallazgos'}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                {delDia.map((h) => {
                  const expandido = abierto === h.id;
                  return (
                    <article
                      key={h.id}
                      className={`rounded-lg border bg-white p-3 ${h.descartado ? 'border-line opacity-60' : h.promovido ? 'border-accent/40' : 'border-line'}`}
                    >
                      <div className="flex items-start gap-3">
                        {h.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={h.thumbnail} alt="" className="w-16 h-16 rounded object-cover shrink-0 bg-gray-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1 text-xs">
                            <span className="font-medium">@{h.creador}</span>
                            {h.creadorNombre && <span className="text-muted truncate">{h.creadorNombre}</span>}
                            {/* Los seguidores son el contexto que decide si promover: 3000 likes
                                con 900 seguidores es un hallazgo; con 900 mil es rutina. */}
                            {h.seguidores != null && (
                              <span className="text-muted" title="Seguidores de la cuenta">{fmtNum(h.seguidores)} seg.</span>
                            )}
                            {h.busqueda && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-muted text-[10px]">{h.busqueda}</span>
                            )}
                            {h.promovido && <span className="text-[10px] text-accent">✓ en Fuentes</span>}
                            <span className="text-muted">{fmtHora(h.fechaPublicacion)}</span>
                          </div>

                          <p
                            className={`text-sm text-gray-800 whitespace-pre-wrap ${expandido ? '' : 'line-clamp-3'} cursor-pointer`}
                            onClick={() => setAbierto(expandido ? null : h.id)}
                          >
                            {h.caption}
                          </p>

                          {expandido && !!h.respuestasAutor?.length && (
                            <div className="mt-2 space-y-1.5">
                              <div className="text-[10px] uppercase tracking-wide text-muted">🧵 Respuestas del autor</div>
                              {h.respuestasAutor.map((r) => (
                                <p key={r.id} className="text-xs text-gray-700 whitespace-pre-wrap rounded bg-gray-50 border border-line p-2">
                                  {r.texto}
                                </p>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted tabular-nums">
                            <span>❤️ {fmtNum(h.likes)}</span>
                            <span>👁 {fmtNum(h.views)}</span>
                            <span>🔁 {fmtNum(h.retweets)}</span>
                            {h.tipo && h.tipo !== 'Texto' && <span>{h.tipo}</span>}
                            {h.url && (
                              <a href={h.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                                Ver en X ↗
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1 shrink-0">
                          {!h.promovido && !h.descartado && (
                            <button
                              onClick={() => accion(h, 'promover')}
                              disabled={actuando === h.id}
                              className="text-[11px] px-2 h-7 rounded-md bg-accent text-white font-medium disabled:opacity-60"
                              title={`Añadir @${h.creador} a Fuentes → Cuentas X: a partir de ahí se scrapea y archiva como las demás`}
                            >
                              ＋ Fuentes
                            </button>
                          )}
                          {!h.descartado ? (
                            <button
                              onClick={() => accion(h, 'descartar')}
                              disabled={actuando === h.id}
                              className="text-[11px] px-2 h-7 rounded-md border border-line hover:bg-gray-50 text-muted disabled:opacity-60"
                              title="Quitar de la vista"
                            >
                              Descartar
                            </button>
                          ) : (
                            <button
                              onClick={() => accion(h, 'restaurar')}
                              disabled={actuando === h.id}
                              className="text-[11px] px-2 h-7 rounded-md border border-line hover:bg-gray-50 text-muted disabled:opacity-60"
                            >
                              Restaurar
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
