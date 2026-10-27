'use client';

// Radar: lo que se ha descubierto en X, YouTube y LinkedIn, agrupado por TEMA.
//
// No es la galería. Aquí no se cura ni se archiva nada: es una bandeja de descubrimiento en la que
// cada hallazgo se juzga una vez. Lo bueno se GUARDA (ese post entra a la galería y se archiva) o
// se PROMUEVE (su autor entra a Fuentes y se scrapea como cualquier cuenta); lo demás se descarta.
//
// La unidad es la tarjeta de TEMA y no la fila de post (DESIGN.md 5.2): el mismo lanzamiento
// aparece cincuenta veces, y cincuenta filas no se leen. Medido el 22 oct 2026: 108 hallazgos de un
// día caben en 8 tarjetas.
//
// El tema se calcula al insertar (`radar.temas`, por alias, sin IA), así que agrupar aquí es
// gratis y determinista. El título escrito por IA y el ÁNGULO de DESIGN.md 5.2 son la segunda
// versión: mientras no existan, la tarjeta no finge tenerlos.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtDateRel, fmtNum } from '@/lib/format';
import { useToast } from './ui/Toast';
import { useActivity } from './ui/Activity';
import Spinner from './ui/Spinner';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';

interface Props {
  // Para llevar a gestionar las consultas sin que el usuario tenga que adivinar dónde están.
  onGestionarConsultas?: () => void;
}

interface Hallazgo {
  id: string;
  plataforma: string | null;
  postId: string;
  busqueda: string | null;
  creador: string | null;
  creadorNombre: string | null;
  creadorUrl: string | null;
  seguidores: number | null;
  url: string | null;
  caption: string | null;
  fechaPublicacion: string | null;
  dia: string;
  views: number | null;
  likes: number | null;
  comentarios: number | null;
  velocidad: number | null;
  temas: string[];
  thumbnail: string | null;
  promovido: boolean;
  guardado: boolean;
  descartado: boolean;
  scrapeadoEn: string | null;
}

const PLATAFORMAS = [
  { key: '', label: 'Todo' },
  { key: 'yt', label: 'YouTube' },
  { key: 'x', label: 'X' },
  { key: 'li', label: 'LinkedIn' },
  { key: 'rd', label: 'Reddit' },
];

// El idioma es una dimensión de señal propia desde que el radar busca en tres (DESIGN.md 5.7): la
// decisión de contenido es distinta si un tema arde en inglés y está vacío en español.
const IDIOMAS = [
  { key: '', label: 'Todo' },
  { key: 'es', label: 'ES' },
  { key: 'en', label: 'EN' },
  { key: 'pt', label: 'PT' },
];

const RANGOS = [
  { key: '1', label: 'Hoy' },
  { key: '3', label: '3 días' },
  { key: '7', label: '7 días' },
  { key: '', label: 'Todo' },
];

const ORDENES = [
  { key: 'velocidad', label: 'Velocidad' },
  { key: '', label: 'Reacciones' },
];

const PAGE_SIZE = 500;

const NOMBRE_PLATAFORMA: Record<string, string> = { yt: 'YouTube', x: 'X', li: 'LinkedIn', rd: 'Reddit' };

// Las sobras: lo que no cayó en ningún tema de Dante. Tiene su propia tarjeta para no desaparecer
// en silencio, pero no compite con los temas (ver el orden de `tarjetas`).
const SIN_TEMA = 'Sin tema';

function desdeHace(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(
    new Date(Date.now() - (dias - 1) * 86_400_000)
  );
}

// El idioma sale del sufijo de la etiqueta de la consulta (`claude · es`), que es la convención con
// la que quedaron nombradas. Es un filtro de la vista, no estado guardado, así que no hace falta
// una columna que haya que mantener de acuerdo con el texto de la consulta.
function idiomaDe(h: Hallazgo): string {
  const m = /·\s*(en|es|pt)\s*$/i.exec(h.busqueda || '');
  return m ? m[1].toLowerCase() : '';
}

// Horas desde que se publicó. Es lo que convierte un número de vistas en una señal.
function horasDe(h: Hallazgo): number | null {
  if (!h.fechaPublicacion) return null;
  const ms = Date.now() - new Date(h.fechaPublicacion).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

function edadCorta(h: Hallazgo): string {
  const hs = horasDe(h);
  if (hs === null) return '—';
  if (hs < 1) return 'ahora';
  if (hs < 48) return `hace ${Math.round(hs)} h`;
  return `hace ${Math.round(hs / 24)} d`;
}

// La métrica que lleva la velocidad de cada plataforma: vistas/h en YouTube, reacciones/h en X,
// upvotes/h en Reddit.
//
// Ojo con Reddit: el radar busca en `rising`, que coge los posts ANTES de que exploten, así que
// traen 1-5 upvotes y la velocidad es casi ruido (medido el 27 oct 2026). Se enseña por coherencia,
// pero en Reddit lo que decide es el TÍTULO y el subreddit, no el número.
// Decirlo evita la pregunta de "2.400 de qué".
function unidadDe(plataforma: string | null): string {
  if (plataforma === 'yt') return 'vistas/h';
  if (plataforma === 'rd') return 'upvotes/h';
  return 'reacciones/h';
}

interface Tarjeta {
  tema: string;
  hallazgos: Hallazgo[];
  velocidadMax: number;
  porPlataforma: [string, number][];
  porIdioma: [string, number][];
  masFresco: Hallazgo | null;
}

export default function RadarView({ onGestionarConsultas }: Props) {
  const toast = useToast();
  const activity = useActivity();
  const [plataforma, setPlataforma] = useState('');
  const [idioma, setIdioma] = useState('');
  const [tema, setTema] = useState('');
  const [rango, setRango] = useState('7');
  const [orden, setOrden] = useState('velocidad');
  const [q, setQ] = useState('');
  const [verDescartados, setVerDescartados] = useState(false);
  const [items, setItems] = useState<Hallazgo[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [actuando, setActuando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (plataforma) params.set('plataforma', plataforma);
    if (rango) params.set('desde', desdeHace(Number(rango)));
    if (orden) params.set('orden', orden);
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
  }, [plataforma, rango, orden, q, verDescartados]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // El idioma y el tema se filtran en el cliente: ya están en lo que se trajo, y pedirlos al
  // servidor costaría una vuelta más sin añadir nada.
  const visibles = useMemo(
    () => items.filter((h) => (!idioma || idiomaDe(h) === idioma) && (!tema || h.temas.includes(tema))),
    [items, idioma, tema]
  );

  // Las fichas de tema se sacan de lo que hay, no de la tabla de temas: una ficha para un tema sin
  // hallazgos sería un filtro que solo sabe vaciar la pantalla.
  const temasDisponibles = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const h of items) {
      if (idioma && idiomaDe(h) !== idioma) continue;
      for (const t of h.temas) conteo.set(t, (conteo.get(t) || 0) + 1);
    }
    return [...conteo.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, idioma]);

  const tarjetas = useMemo<Tarjeta[]>(() => {
    const porTema = new Map<string, Hallazgo[]>();
    // Un hallazgo con dos temas sale en las dos tarjetas: un video de "Seedance vs Claude" es de
    // los dos, y forzarlo a uno perdería la mitad de su utilidad al filtrar.
    for (const h of visibles) {
      const claves = h.temas.length ? h.temas : [SIN_TEMA];
      for (const t of claves) {
        if (!porTema.has(t)) porTema.set(t, []);
        porTema.get(t)!.push(h);
      }
    }
    const cuenta = (hs: Hallazgo[], f: (h: Hallazgo) => string) => {
      const m = new Map<string, number>();
      for (const h of hs) {
        const k = f(h);
        if (k) m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return [...porTema.entries()]
      .map(([t, hs]) => {
        const ordenados = [...hs].sort((a, b) => (b.velocidad || 0) - (a.velocidad || 0));
        const conFecha = hs.filter((h) => h.fechaPublicacion);
        return {
          tema: t,
          hallazgos: ordenados,
          velocidadMax: ordenados[0]?.velocidad || 0,
          porPlataforma: cuenta(hs, (h) => NOMBRE_PLATAFORMA[h.plataforma || ''] || ''),
          porIdioma: cuenta(hs, (h) => idiomaDe(h).toUpperCase()),
          masFresco:
            conFecha.sort(
              (a, b) =>
                new Date(b.fechaPublicacion!).getTime() - new Date(a.fechaPublicacion!).getTime()
            )[0] || null,
        };
      })
      // La tarjeta se ordena por su hallazgo más rápido: el tema que arde sube solo. «Sin tema»
      // queda SIEMPRE al final aunque su velocidad sea alta: no es un tema, son las sobras, y
      // dejarla competir la colaba entre los temas de verdad (medido: 3er lugar con 68 hallazgos
      // viejos de X sin clasificar).
      .sort((a, b) => {
        if (a.tema === SIN_TEMA) return 1;
        if (b.tema === SIN_TEMA) return -1;
        return b.velocidadMax - a.velocidadMax;
      });
  }, [visibles]);

  // Frescura: sin cron no hay garantía de que esto sea de hoy, así que se dice (DESIGN.md 5.8).
  const ultimaEntrada = useMemo(() => {
    const fechas = items.map((h) => h.scrapeadoEn).filter(Boolean) as string[];
    if (!fechas.length) return null;
    return fechas.sort().at(-1) || null;
  }, [items]);

  async function guardar(h: Hallazgo) {
    if (guardando) return;
    setGuardando(h.id);
    const quien = h.creadorNombre || h.creador || 'el hallazgo';
    const doneAct = activity.begin(`Guardando ${quien}…`);
    try {
      const res = await fetch('/api/radar/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: h.id }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo guardar');
      toast.success(`Guardado en la galería como ${d.codigo}. Pégalo en el buscador para abrirlo.`);
      setItems((prev) => prev.map((x) => (x.id === h.id ? { ...x, guardado: true } : x)));
    } catch (e: any) {
      toast.error(e.message || 'No se pudo guardar');
    } finally {
      setGuardando(null);
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
        toast.success(d.yaEstaba ? `${d.handle} ya estaba en Fuentes` : `${d.handle} añadido a Fuentes`);
      }
      setItems((prev) =>
        acc === 'descartar' && !verDescartados
          ? prev.filter((x) => x.id !== h.id)
          : prev.map((x) =>
              x.id === h.id
                ? { ...x, promovido: acc === 'promover' || x.promovido, descartado: acc === 'descartar' }
                : x
            )
      );
    } catch (e: any) {
      toast.error(e.message || 'No se pudo');
    } finally {
      setActuando(null);
    }
  }

  const segmentado = (
    opciones: { key: string; label: string }[],
    valor: string,
    set: (v: string) => void,
    title?: string
  ) => (
    <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs" title={title}>
      {opciones.map((o) => (
        <button
          key={o.key}
          onClick={() => set(o.key)}
          className={`px-2.5 py-1.5 rounded-md ${valor === o.key ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold tracking-tight mr-1">📡 Radar</h2>
        {segmentado(PLATAFORMAS, plataforma, setPlataforma, 'De qué red salió el hallazgo')}
        {segmentado(IDIOMAS, idioma, setIdioma, 'El idioma de la consulta que lo encontró')}
        {segmentado(RANGOS, rango, setRango)}
        {segmentado(ORDENES, orden, setOrden, 'La velocidad detecta lo que explota ahora; las reacciones, lo más grande')}

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en el texto…"
          className="h-8 px-2.5 text-sm rounded-lg border border-line bg-white outline-none focus:border-accent w-44"
        />

        <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={verDescartados}
            onChange={(e) => setVerDescartados(e.target.checked)}
          />
          Ver descartados
        </label>

        <span className="flex-1" />
        {loading && <Spinner size={14} />}
        <span className="text-xs text-muted tabular-nums">
          {tarjetas.length} temas · {visibles.length} de {total}
        </span>
        {onGestionarConsultas && (
          <button
            onClick={onGestionarConsultas}
            className="h-9 px-3 text-sm rounded-lg border border-line bg-white hover:bg-gray-50"
            title="Añadir, editar o apagar las consultas que se rastrean, en los tres idiomas"
          >
            ⚙️ Consultas
          </button>
        )}
      </div>

      {/* Fichas de tema. Van en su propia fila: con 11 temas, meterlas entre los segmentados
          rompía la cabecera en pantallas estrechas. */}
      {temasDisponibles.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <button
            onClick={() => setTema('')}
            className={`px-2.5 py-1 text-xs rounded-full border ${
              !tema ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line bg-white text-muted'
            }`}
          >
            Todos
          </button>
          {temasDisponibles.map(([t, n]) => (
            <button
              key={t}
              onClick={() => setTema(tema === t ? '' : t)}
              className={`px-2.5 py-1 text-xs rounded-full border ${
                tema === t
                  ? 'border-accent bg-accent-soft text-accent font-medium'
                  : 'border-line bg-white text-muted hover:bg-gray-50'
              }`}
            >
              {t} <span className="tabular-nums opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      {/* El radar se llena a pedido, así que decir cuándo entró algo evita leerlo como si fuera de
          hoy (DESIGN.md 5.8). */}
      {ultimaEntrada && (
        <p className="text-xs text-muted mb-4">
          Última entrada al radar: {fmtDateRel(ultimaEntrada)}. Se llena a pedido, no solo.
        </p>
      )}

      {error && !items.length ? (
        <ErrorState message={error} onRetry={fetchPage} />
      ) : !loaded ? (
        <div className="flex justify-center py-16">
          <Spinner size={22} />
        </div>
      ) : !tarjetas.length ? (
        <EmptyState
          icon="📡"
          title={items.length ? 'Nada con estos filtros' : 'El radar está vacío'}
          description={
            items.length
              ? 'Hay hallazgos, pero ninguno coincide con el tema, el idioma o el texto que buscas.'
              : 'Pide los hallazgos por chat y aparecerán aquí. Las consultas se editan en Fuentes.'
          }
          actionLabel={items.length ? 'Quitar filtros' : undefined}
          onAction={
            items.length
              ? () => {
                  setTema('');
                  setIdioma('');
                  setQ('');
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {tarjetas.map((t) => {
            const abierta = !!abiertas[t.tema];
            return (
              <div key={t.tema} className="border border-line rounded-xl bg-white overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold tracking-tight truncate">{t.tema}</h3>
                      <p className="text-xs text-muted mt-1">
                        {t.porPlataforma.map(([p, n]) => `${p} (${n})`).join(' · ')}
                        {t.porIdioma.length > 0 && (
                          <>
                            {' — '}
                            {t.porIdioma.map(([i, n]) => `${i} ${n}`).join(' · ')}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums">⚡ {fmtNum(Math.round(t.velocidadMax))}</div>
                      <div className="text-xs text-muted">
                        {unidadDe(t.hallazgos[0]?.plataforma || null)}
                      </div>
                      {t.masFresco && (
                        <div className="text-xs text-muted mt-0.5">{edadCorta(t.masFresco)}</div>
                      )}
                    </div>
                  </div>

                  {/* El hallazgo más rápido se asoma sin abrir la tarjeta: es el que decide si
                      merece la pena mirar dentro. */}
                  {t.hallazgos[0] && (
                    <p className="text-sm mt-3 line-clamp-2">
                      <a
                        href={t.hallazgos[0].url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-accent"
                      >
                        {t.hallazgos[0].caption || '(sin texto)'}
                      </a>
                      <span className="text-muted">
                        {' '}
                        — {t.hallazgos[0].creadorNombre || t.hallazgos[0].creador}
                      </span>
                    </p>
                  )}

                  <button
                    onClick={() => setAbiertas((p) => ({ ...p, [t.tema]: !abierta }))}
                    className="mt-3 text-xs text-accent hover:underline"
                  >
                    {abierta ? 'Ocultar fuentes' : `Ver fuentes (${t.hallazgos.length})`}
                  </button>
                </div>

                {/* Nivel 2 de la divulgación progresiva: expande en la misma tarjeta, no en un
                    modal, para poder comparar sin perder el sitio. */}
                {abierta && (
                  <div className="border-t border-line divide-y divide-line bg-gray-50/50">
                    {t.hallazgos.map((h) => (
                      <div key={h.id} className="p-3 flex gap-3 items-start">
                        {h.thumbnail && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={h.thumbnail}
                            alt=""
                            className="w-28 aspect-video object-cover rounded-md border border-line shrink-0 bg-gray-100"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <a
                            href={h.url || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium hover:text-accent line-clamp-2"
                          >
                            {h.caption || '(sin texto)'}
                          </a>
                          <p className="text-xs text-muted mt-1">
                            {h.creadorUrl ? (
                              <a href={h.creadorUrl} target="_blank" rel="noreferrer" className="hover:text-accent">
                                {h.creadorNombre || h.creador}
                              </a>
                            ) : (
                              (h.creadorNombre || h.creador) ?? '—'
                            )}
                            {h.seguidores ? ` · ${fmtNum(h.seguidores)} seg.` : ''}
                            {` · ${edadCorta(h)}`}
                            {h.busqueda ? ` · ${h.busqueda}` : ''}
                          </p>
                          <p className="text-xs text-muted mt-0.5 tabular-nums">
                            ⚡ {fmtNum(Math.round(h.velocidad || 0))} {unidadDe(h.plataforma)}
                            {h.views !== null ? ` · ${fmtNum(h.views)} vistas` : ''}
                            {h.likes !== null ? ` · ${fmtNum(h.likes)} ❤️` : ''}
                            {h.comentarios !== null ? ` · ${fmtNum(h.comentarios)} 💬` : ''}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {/* Guardar se queda con ESTE post; ＋Fuentes sigue a la CUENTA. Son dos
                              intenciones distintas y por eso son dos botones. */}
                          <button
                            onClick={() => guardar(h)}
                            disabled={h.guardado || guardando === h.id}
                            className="h-7 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-50 disabled:opacity-50"
                            title="Guardar este contenido en la galería, con su video y su transcripción"
                          >
                            {h.guardado ? '✓ Guardado' : guardando === h.id ? '…' : '💾 Guardar'}
                          </button>
                          <button
                            onClick={() => accion(h, 'promover')}
                            disabled={h.promovido || actuando === h.id}
                            className="h-7 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-50 disabled:opacity-50"
                            title="Seguir a esta cuenta: entra a Fuentes y se scrapea de aquí en adelante"
                          >
                            {h.promovido ? '✓ En Fuentes' : '＋ Fuentes'}
                          </button>
                          <button
                            onClick={() => accion(h, h.descartado ? 'restaurar' : 'descartar')}
                            disabled={actuando === h.id}
                            className="h-7 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-50 disabled:opacity-50"
                            title={h.descartado ? 'Devolverlo a la vista' : 'Quitarlo de la vista'}
                          >
                            {h.descartado ? '↩ Restaurar' : '✕'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
