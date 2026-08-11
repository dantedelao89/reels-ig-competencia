'use client';

// Tab "Regenerar" del detalle de un carrusel IG: muestra el plan por slide que armó la IA
// (acción + referencia + texto traducido + prompt), deja editarlo/anotarlo, lanza la generación
// en el scraper (fire-and-forget) y hace polling del avance. Al final, comparador original vs
// regenerado, re-tiros individuales y descarga del carrusel final en .zip.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentItem, CarouselSlide } from '@/lib/types';
import { useToast } from './ui/Toast';
import AsyncButton from './ui/AsyncButton';
import Spinner from './ui/Spinner';
import type { RegenRef } from './RefsManager';

interface RegenSlide {
  idx: number;
  tipoMedia: 'image' | 'video';
  accion: 'copiar' | 'limpiar' | 'regenerar';
  tipoSlide: string;
  refId: string | null;
  textoOriginal: string | null;
  textoNuevo: string | null;
  nota: string | null;
  prompt: string | null;
  estado: 'pendiente' | 'generando' | 'listo' | 'error';
  outputUrl: string | null;
  error: string | null;
  modelo: string | null;
}

const ACCION_LABEL: Record<string, string> = {
  copiar: '📷 Copiar tal cual',
  limpiar: '🧽 Limpiar marca',
  regenerar: '🎨 Regenerar',
};

const TIPO_SLIDE_OPCIONES = ['portada', 'lista', 'quote', 'numero', 'contenido', 'cta', 'foto'];

function estimateCost(plan: RegenSlide[]): number {
  const n = (a: string) => plan.filter((s) => s.accion === a).length;
  return Math.round((n('regenerar') * 0.07 + n('limpiar') * 0.02) * 100) / 100;
}

export default function RegenTab({
  item,
  slides,
  onOpenRefs,
}: {
  item: ContentItem;
  slides: CarouselSlide[];
  onOpenRefs: () => void;
}) {
  const toast = useToast();
  const shortcode = item.externalId;

  const [plan, setPlan] = useState<RegenSlide[] | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [dlZip, setDlZip] = useState(false);
  const [refs, setRefs] = useState<RegenRef[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyStatus = useCallback((d: any) => {
    if (Array.isArray(d.regen)) setPlan(d.regen);
    setEstado(d.regenEstado ?? null);
    setActualizado(d.regenActualizado ?? null);
  }, []);

  // Estado inicial + biblioteca de referencias (para el selector).
  useEffect(() => {
    let alive = true;
    fetch(`/api/regen/status?id=${item.id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => alive && !d.error && applyStatus(d))
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    fetch('/api/regen/refs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => alive && Array.isArray(d.refs) && setRefs(d.refs))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.id, applyStatus]);

  // Polling mientras hay generación en curso.
  const generating = estado === 'generando' || (plan?.some((s) => s.estado === 'generando') ?? false);
  useEffect(() => {
    if (!generating) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const d = await (await fetch(`/api/regen/status?id=${item.id}`, { cache: 'no-store' })).json();
        if (!d.error) applyStatus(d);
      } catch {}
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [generating, item.id, applyStatus]);

  async function analyze() {
    if (plan && !confirm('Re-analizar borra el plan actual (notas y ediciones incluidas). ¿Seguir?')) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/regen/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo analizar');
      setPlan(d.plan);
      setEstado('plan');
      toast.success(`Plan listo: ${d.plan.length} slides (~$${d.costoEstimado} USD al generar)`);
    } catch (e: any) {
      toast.error(e.message || 'No se pudo analizar');
    } finally {
      setAnalyzing(false);
    }
  }

  // Edición local + persistencia por slide (RPC atómica en el servidor).
  function editLocal(idx: number, patch: Partial<RegenSlide>) {
    setPlan((prev) => prev && prev.map((s) => (s.idx === idx ? { ...s, ...patch } : s)));
  }

  async function persist(idx: number, patch: Partial<RegenSlide>) {
    try {
      const res = await fetch('/api/regen/slide', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode, idx, patch }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo guardar');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function generate(indices?: number[]) {
    setLaunching(true);
    try {
      const res = await fetch('/api/regen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode, indices }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo lanzar');
      toast.success(`Generando ${d.launched} slide${d.launched > 1 ? 's' : ''} (3-6 min c/u)`);
      setEstado('generando');
      setPlan(
        (prev) =>
          prev &&
          prev.map((s) =>
            (indices ? indices.includes(s.idx) : s.accion !== 'copiar' && s.estado !== 'listo')
              ? { ...s, estado: 'generando', error: null }
              : s
          )
      );
    } catch (e: any) {
      toast.error(e.message || 'No se pudo lanzar');
    } finally {
      setLaunching(false);
    }
  }

  async function downloadZip() {
    if (!plan || dlZip) return;
    setDlZip(true);
    const width = String(plan.length).length;
    const base = (item.creador || 'carrusel').replace(/[^\w.-]/g, '_');
    const payload = plan.map((s) => {
      const url = s.outputUrl || slides[s.idx]?.url || '';
      const ext = s.tipoMedia === 'video' ? 'mp4' : s.outputUrl && s.accion !== 'copiar' ? 'png' : 'jpg';
      return { url, name: `${String(s.idx + 1).padStart(width, '0')}.${ext}` };
    });
    try {
      const res = await fetch('/api/carousel-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides: payload, zipName: `regen_${base}` }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo generar el zip');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `regen_${base}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.message || 'No se pudo descargar');
    } finally {
      setDlZip(false);
    }
  }

  if (!loaded) {
    return (
      <div className="p-10 flex justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  // --- Estado vacío: aún no hay plan ---
  if (!plan) {
    return (
      <div className="p-10 text-center max-w-md mx-auto">
        <div className="text-3xl mb-3">🎨</div>
        <h3 className="font-semibold mb-2">Regenerar este carrusel con tu branding</h3>
        <p className="text-sm text-muted mb-1">
          La IA clasifica cada slide (copiar / limpiar marca / regenerar), traduce el texto y elige la
          referencia de tu biblioteca. Tú revisas el plan y le pones notas antes de gastar.
        </p>
        <p className="text-xs text-muted mb-5">
          Analizar cuesta centavos; generar ~$0.07 USD por slide regenerado.
        </p>
        <AsyncButton onClick={analyze} loading={analyzing} loadingLabel="Analizando (~1 min)…">
          ✨ Analizar carrusel ({slides.length} slides)
        </AsyncButton>
        <div className="mt-3">
          <button onClick={onOpenRefs} className="text-xs text-muted hover:text-accent underline underline-offset-2">
            Gestionar referencias
          </button>
        </div>
      </div>
    );
  }

  const pendientes = plan.filter((s) => s.accion !== 'copiar' && s.estado !== 'listo');
  const enCurso = plan.filter((s) => s.estado === 'generando').length;
  const listosGen = plan.filter((s) => s.accion !== 'copiar' && s.estado === 'listo').length;
  const totalGen = plan.filter((s) => s.accion !== 'copiar').length;
  const errores = plan.filter((s) => s.estado === 'error').length;
  const todoListo = plan.every((s) => s.estado === 'listo');
  // Job huérfano (redeploy a mitad): sigue 'generando' pero sin avance en >15 min → ofrecer reanudar.
  const stale =
    estado === 'generando' && actualizado != null && Date.now() - new Date(actualizado).getTime() > 15 * 60 * 1000;

  return (
    <div className="p-4">
      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-2.5 rounded-lg border border-line bg-gray-50">
        {generating && !stale ? (
          <span className="inline-flex items-center gap-2 text-sm text-gray-700">
            <Spinner size={14} /> Generando… {listosGen}/{totalGen} listos
            {enCurso > 0 && <span className="text-xs text-muted">({enCurso} en curso, 3-6 min c/u)</span>}
          </span>
        ) : (
          <>
            <AsyncButton
              onClick={() => generate()}
              loading={launching}
              loadingLabel="Lanzando…"
              disabled={pendientes.length === 0}
              title={pendientes.length ? `~$${estimateCost(pendientes)} USD` : 'No hay slides pendientes'}
            >
              {stale ? '▶️ Reanudar generación' : `🚀 Generar ${pendientes.length} slide${pendientes.length === 1 ? '' : 's'}`}
              {pendientes.length > 0 && <span className="opacity-75 ml-1">(~${estimateCost(pendientes)})</span>}
            </AsyncButton>
            {todoListo && totalGen > 0 && (
              <AsyncButton onClick={downloadZip} loading={dlZip} loadingLabel="Generando ZIP…" variant="secondary">
                ⬇️ Descargar carrusel final (.zip)
              </AsyncButton>
            )}
          </>
        )}
        <span className="flex-1" />
        {errores > 0 && <span className="text-xs text-red-600">{errores} con error</span>}
        <button onClick={onOpenRefs} className="text-xs text-muted hover:text-accent underline underline-offset-2">
          Referencias
        </button>
        <button
          onClick={analyze}
          disabled={analyzing || generating}
          className="text-xs text-muted hover:text-accent underline underline-offset-2 disabled:opacity-50"
        >
          {analyzing ? 'Analizando…' : '↻ Re-analizar'}
        </button>
      </div>

      {/* Cards por slide */}
      <div className="space-y-3">
        {plan.map((s) => {
          const original = slides[s.idx];
          const editable = s.estado !== 'generando';
          const refsDelTipo = s.tipoSlide === 'cta' ? refs.filter((r) => r.tipo === 'cta') : refs;
          const refSel = refs.find((r) => r.id === s.refId) || null;
          return (
            <div key={s.idx} className="rounded-xl border border-line bg-white p-3">
              <div className="flex gap-3">
                {/* Original */}
                <div className="shrink-0 w-24">
                  <div className="relative w-24 pt-[125%] rounded-lg overflow-hidden bg-gray-100 border border-line">
                    {s.tipoMedia === 'video' ? (
                      <>
                        {original?.poster && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={original.poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">▶</span>
                      </>
                    ) : (
                      original?.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={original.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      )
                    )}
                    <span className="absolute top-1 left-1 text-[10px] px-1 rounded bg-black/60 text-white">{s.idx + 1}</span>
                  </div>
                  <div className="text-[10px] text-muted text-center mt-1">Original</div>
                </div>

                {/* Resultado (cuando existe) */}
                {s.accion !== 'copiar' && (s.outputUrl || s.estado === 'generando' || s.estado === 'error') && (
                  <div className="shrink-0 w-24">
                    <div className="relative w-24 pt-[125%] rounded-lg overflow-hidden bg-gray-100 border border-line">
                      {s.outputUrl ? (
                        <a href={s.outputUrl} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.outputUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        </a>
                      ) : s.estado === 'generando' ? (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <Spinner size={18} />
                        </span>
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-red-400 text-lg">✕</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted text-center mt-1">
                      {s.estado === 'generando' ? 'Generando…' : s.modelo ? `Nueva (${s.modelo})` : 'Nueva'}
                    </div>
                  </div>
                )}

                {/* Plan editable */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <select
                      value={s.accion}
                      disabled={!editable || s.tipoMedia === 'video'}
                      onChange={(e) => {
                        const accion = e.target.value as RegenSlide['accion'];
                        const patch: Partial<RegenSlide> = { accion };
                        editLocal(s.idx, { ...patch, estado: accion === 'copiar' ? 'listo' : 'pendiente', outputUrl: accion === 'copiar' ? original?.url || null : s.outputUrl });
                        persist(s.idx, patch);
                      }}
                      className="h-8 text-xs rounded-md border border-line px-2 bg-white disabled:opacity-60"
                    >
                      {Object.entries(ACCION_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    {s.accion === 'regenerar' && (
                      <>
                        <select
                          value={s.tipoSlide}
                          disabled={!editable}
                          onChange={(e) => {
                            editLocal(s.idx, { tipoSlide: e.target.value });
                            persist(s.idx, { tipoSlide: e.target.value });
                          }}
                          className="h-8 text-xs rounded-md border border-line px-2 bg-white disabled:opacity-60"
                        >
                          {TIPO_SLIDE_OPCIONES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1.5">
                          {refSel && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={refSel.url} alt="" className="w-8 h-8 rounded object-cover border border-line" title={refSel.nombre} />
                          )}
                          <select
                            value={s.refId || ''}
                            disabled={!editable}
                            onChange={(e) => {
                              const refId = e.target.value || null;
                              editLocal(s.idx, { refId });
                              persist(s.idx, { refId });
                            }}
                            className="h-8 text-xs rounded-md border border-line px-2 bg-white disabled:opacity-60 max-w-[160px]"
                            title="Referencia de estilo"
                          >
                            <option value="">— sin referencia —</option>
                            {refsDelTipo.map((r) => (
                              <option key={r.id} value={r.id}>{r.nombre} ({r.tipo})</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    <span className="flex-1" />
                    {s.estado === 'listo' && s.accion !== 'copiar' && !generating && (
                      <button
                        onClick={() => generate([s.idx])}
                        className="h-8 px-2.5 text-xs rounded-md border border-line bg-white hover:bg-gray-50"
                        title="Volver a generar este slide (usa la nota como instrucción)"
                      >
                        🔁 Re-tirar
                      </button>
                    )}
                    {s.estado === 'error' && !generating && (
                      <button
                        onClick={() => generate([s.idx])}
                        className="h-8 px-2.5 text-xs rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        ↻ Reintentar
                      </button>
                    )}
                  </div>

                  {s.error && <div className="text-xs text-red-600 mb-2">⚠️ {s.error}</div>}

                  {s.accion === 'regenerar' && (
                    <textarea
                      value={s.textoNuevo || ''}
                      disabled={!editable}
                      onChange={(e) => editLocal(s.idx, { textoNuevo: e.target.value })}
                      onBlur={(e) => persist(s.idx, { textoNuevo: e.target.value || null })}
                      placeholder="Texto de la nueva lámina (en español)…"
                      className="w-full text-xs border border-line rounded-md p-2 mb-2 outline-none focus:border-accent resize-y min-h-[54px] disabled:opacity-60"
                    />
                  )}

                  {s.accion !== 'copiar' && (
                    <input
                      value={s.nota || ''}
                      disabled={!editable}
                      onChange={(e) => editLocal(s.idx, { nota: e.target.value })}
                      onBlur={(e) => persist(s.idx, { nota: e.target.value || null })}
                      placeholder="📝 Nota para la generación (opcional): 'usa modo noche', 'cambia el CTA a…'"
                      className="w-full h-8 text-xs border border-line rounded-md px-2 mb-2 outline-none focus:border-accent disabled:opacity-60"
                    />
                  )}

                  {s.accion === 'regenerar' && s.prompt != null && (
                    <details className="text-xs">
                      <summary className="text-muted cursor-pointer select-none">Prompt (avanzado)</summary>
                      <textarea
                        value={s.prompt || ''}
                        disabled={!editable}
                        onChange={(e) => editLocal(s.idx, { prompt: e.target.value })}
                        onBlur={(e) => persist(s.idx, { prompt: e.target.value || null })}
                        className="w-full text-[11px] font-mono border border-line rounded-md p-2 mt-1 outline-none focus:border-accent resize-y min-h-[120px] disabled:opacity-60"
                      />
                    </details>
                  )}

                  {s.accion === 'copiar' && (
                    <div className="text-xs text-muted">
                      {s.tipoMedia === 'video' ? 'Video: pasa tal cual al carrusel final.' : 'Pasa tal cual al carrusel final (solo fotos, sin marcas).'}
                    </div>
                  )}
                  {s.textoOriginal && s.accion !== 'regenerar' && (
                    <div className="text-[11px] text-muted mt-1 line-clamp-2" title={s.textoOriginal}>
                      Texto detectado: {s.textoOriginal}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
