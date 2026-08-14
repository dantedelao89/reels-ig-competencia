'use client';

// Archivo de historias de Instagram: agrupadas por día, en el orden en que se publicaron.
// Las historias caducan en 24h en Instagram; aquí quedan para siempre con su hora real.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtDiaRel, fmtHora, hoyEnTz } from '@/lib/format';
import { useToast } from './ui/Toast';
import { useActivity } from './ui/Activity';
import AsyncButton from './ui/AsyncButton';
import Spinner from './ui/Spinner';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import StoryViewer from './stories/StoryViewer';

export interface Story {
  id: string;
  storyId: string;
  creador: string;
  fechaPublicacion: string;
  dia: string;
  tipo: 'image' | 'video';
  mediaUrl: string | null;
  posterUrl: string | null;
  mediaError: string | null;
  tieneAudio: boolean | null;
}

const RANGOS = [
  { key: '1', label: 'Hoy' },
  { key: '7', label: '7 días' },
  { key: '30', label: '30 días' },
  { key: '', label: 'Todo' },
];

const PAGE_SIZE = 200;

// 'YYYY-MM-DD' de hace N días en CDMX.
function desdeHace(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(
    new Date(Date.now() - (dias - 1) * 86_400_000)
  );
}

export default function StoriesView() {
  const toast = useToast();
  const activity = useActivity();

  const [cuentas, setCuentas] = useState<{ id: string; key: string }[]>([]);
  const [creador, setCreador] = useState('');
  const [rango, setRango] = useState('7');
  const [items, setItems] = useState<Story[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturando, setCapturando] = useState(false);
  const [viendo, setViendo] = useState<number | null>(null); // índice en el array plano

  // Las cuentas salen de las Fuentes de IG que ya existen (sin endpoint nuevo).
  useEffect(() => {
    fetch('/api/sources?type=ig', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.records)) {
          setCuentas(d.records.map((r: any) => ({ id: r.id, key: String(r.key).replace(/^@/, '').toLowerCase() })));
        }
      })
      .catch(() => {});
  }, []);

  const fetchPage = useCallback(
    async (pageNum: number, replace: boolean) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(pageNum), pageSize: String(PAGE_SIZE) });
      if (creador) params.set('creador', creador);
      if (rango) params.set('desde', desdeHace(Number(rango)));
      if (replace) setError(null);
      try {
        const res = await fetch(`/api/stories?${params}`, { cache: 'no-store' });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || `Error ${res.status}`);
        setTotal(d.total);
        setItems((prev) => (replace ? d.items : [...prev, ...d.items]));
        setLoaded(true);
      } catch (e: any) {
        if (replace) setError(e?.message || 'No se pudo cargar');
      } finally {
        setLoading(false);
      }
    },
    [creador, rango]
  );

  useEffect(() => {
    setPage(1);
    fetchPage(1, true);
  }, [fetchPage]);

  // Al volver a la pestaña, recarga (por si capturaste desde Fuentes mientras tanto).
  const lastFocus = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocus.current < 4000) return;
      lastFocus.current = now;
      setPage(1);
      fetchPage(1, true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchPage]);

  async function capturar() {
    if (!creador || capturando) return;
    setCapturando(true);
    const doneAct = activity.begin(`Capturando historias de @${creador}…`);
    try {
      const res = await fetch('/api/scrape-stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: creador }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo capturar');
      if (d.privada || d.accesible === false) toast.info(d.mensaje || 'Cuenta no accesible');
      else if (!d.encontradas) toast.info('Sin historias activas ahora mismo');
      else if (!d.nuevas) toast.info(`Sin novedades: las ${d.encontradas} ya estaban archivadas`);
      else toast.success(`${d.nuevas} historias nuevas de @${creador}`);
      if (d.fallidas) toast.error(`${d.fallidas} no se pudieron archivar (se reintentan en la próxima captura)`);
      setPage(1);
      fetchPage(1, true);
    } catch (e: any) {
      toast.error(e.message || 'No se pudo capturar');
    } finally {
      setCapturando(false);
      doneAct();
    }
  }

  // El array ya viene ordenado (día desc, hora asc): agrupar es solo partirlo por día.
  const dias = useMemo(() => {
    const map = new Map<string, Story[]>();
    for (const s of items) {
      if (!map.has(s.dia)) map.set(s.dia, []);
      map.get(s.dia)!.push(s);
    }
    return [...map.entries()];
  }, [items]);

  const hoy = hoyEnTz();
  const more = items.length < total;

  return (
    <div>
      {/* Cabecera */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold tracking-tight mr-1">📖 Historias</h2>

        <select
          value={creador}
          onChange={(e) => setCreador(e.target.value)}
          className="h-9 px-2 rounded-lg border border-line bg-white text-sm outline-none focus:border-accent"
        >
          <option value="">Todas las cuentas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.key}>@{c.key}</option>
          ))}
        </select>

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

        <span className="flex-1" />

        <AsyncButton
          onClick={capturar}
          loading={capturando}
          loadingLabel="Capturando (~1 min)…"
          disabled={!creador}
          title={
            creador
              ? `Capturar las historias activas de @${creador} (≈$0.008 USD)`
              : 'Elige una cuenta para capturar sus historias'
          }
        >
          📖 Capturar historias
        </AsyncButton>
      </div>

      {!creador && (
        <p className="text-xs text-muted mb-3">
          Elige una cuenta para poder capturar. Las historias solo viven 24 h en Instagram: lo que no
          captures hoy no se recupera.
        </p>
      )}

      {/* Cuerpo */}
      {error && !items.length ? (
        <ErrorState message={error} onRetry={() => fetchPage(1, true)} />
      ) : !loaded ? (
        <div className="flex justify-center py-16"><Spinner size={22} /></div>
      ) : !items.length ? (
        <EmptyState
          icon="📖"
          title="Aún no hay historias archivadas"
          description={
            creador
              ? `No hay historias guardadas de @${creador} en este rango. Captura sus historias activas ahora.`
              : 'Elige una cuenta y captura sus historias activas para empezar el archivo.'
          }
          actionLabel={creador ? 'Capturar ahora' : undefined}
          onAction={creador ? capturar : undefined}
        />
      ) : (
        <>
          {dias.map(([dia, delDia]) => (
            <section key={dia} className="mb-6">
              <div className="flex items-baseline gap-2 mb-2">
                <h3 className="text-sm font-semibold capitalize">{fmtDiaRel(dia)}</h3>
                <span className="text-xs text-muted">
                  {delDia.length} {delDia.length === 1 ? 'historia' : 'historias'}
                  {dia === hoy ? '' : ` · ${dia}`}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {delDia.map((s) => {
                  const idx = items.indexOf(s);
                  const thumb = s.posterUrl || (s.tipo === 'image' ? s.mediaUrl : null);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setViendo(idx)}
                      className={`relative w-[104px] aspect-[9/16] rounded-lg overflow-hidden bg-gray-200 border group ${
                        s.mediaError ? 'border-amber-400' : 'border-line'
                      }`}
                      title={s.mediaError || `${fmtHora(s.fechaPublicacion)} · @${s.creador}`}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                      ) : s.mediaUrl ? (
                        <video src={`${s.mediaUrl}#t=0.5`} preload="metadata" muted className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-2xl text-gray-400">⚠️</span>
                      )}
                      <span className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/60 to-transparent" />
                      <span className="absolute top-1.5 left-1.5 text-[11px] font-medium text-white tabular-nums drop-shadow">
                        {fmtHora(s.fechaPublicacion)}
                      </span>
                      {s.tipo === 'video' && (
                        <span className="absolute bottom-1.5 right-1.5 text-[10px] text-white drop-shadow">▶</span>
                      )}
                      {!creador && (
                        <span className="absolute bottom-1.5 left-1.5 text-[9px] px-1 rounded bg-black/60 text-white max-w-[85%] truncate">
                          @{s.creador}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {more && (
            <div className="flex justify-center py-6">
              <button
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  fetchPage(next, false);
                }}
                disabled={loading}
                className="h-10 px-5 text-sm rounded-lg border border-line bg-white disabled:opacity-60"
              >
                {loading ? 'Cargando…' : 'Cargar más'}
              </button>
            </div>
          )}
        </>
      )}

      {viendo != null && items[viendo] && (
        <StoryViewer items={items} index={viendo} onIndex={setViendo} onClose={() => setViendo(null)} />
      )}
    </div>
  );
}
