'use client';

// Tab "Regenerar": rehace un carrusel ajeno con el estilo de Dante.
// Cuatro estados y una sola decisión suya (el titular). Todo lo demás lo hace la IA:
// lee el carrusel → propone titulares → escribe el guion → genera → se auto-revisa.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentItem, CarouselSlide, RegenSlide, RegenMeta, RegenProgreso } from '@/lib/types';
import { REGEN_OCUPADO } from '@/lib/types';
import { useToast } from './ui/Toast';
import AsyncButton from './ui/AsyncButton';
import Spinner from './ui/Spinner';
import GanchoSelector from './regen/GanchoSelector';
import ProgresoPasos from './regen/ProgresoPasos';
import GaleriaLaminas from './regen/GaleriaLaminas';

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
  const [meta, setMeta] = useState<RegenMeta | null>(null);
  const [progreso, setProgreso] = useState<RegenProgreso | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [brief, setBrief] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [pidiendoOtros, setPidiendoOtros] = useState(false);
  const [instruccion, setInstruccion] = useState('');
  const [instruyendo, setInstruyendo] = useState(false);
  const [dlZip, setDlZip] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const aplicar = useCallback((d: any) => {
    setPlan(Array.isArray(d.regen) ? d.regen : null);
    setMeta(d.regenMeta ?? null);
    setProgreso(d.regenProgreso ?? null);
    setEstado(d.regenEstado ?? null);
    setActualizado(d.regenActualizado ?? null);
  }, []);

  const refrescar = useCallback(async () => {
    try {
      const d = await (await fetch(`/api/regen/status?id=${item.id}`, { cache: 'no-store' })).json();
      if (!d.error) aplicar(d);
    } catch {}
  }, [item.id, aplicar]);

  useEffect(() => {
    refrescar().finally(() => setLoaded(true));
  }, [refrescar]);

  // Mientras hay un job trabajando, polling cada 5s: las láminas van apareciendo solas.
  const trabajando = !!estado && REGEN_OCUPADO.includes(estado);
  useEffect(() => {
    if (!trabajando) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(refrescar, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [trabajando, refrescar]);

  // El plan de la versión anterior no se puede renderizar: se reemplaza al leer.
  const esV1 = !!plan && !meta?.v;

  async function analizar() {
    setAnalizando(true);
    try {
      const res = await fetch('/api/regen/analizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode, brief: brief.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo leer');
      (d.avisos || []).forEach((a: string) => toast.error(a));
      await refrescar();
    } catch (e: any) {
      toast.error(e.message || 'No se pudo leer el carrusel');
    } finally {
      setAnalizando(false);
    }
  }

  async function otrosGanchos() {
    setPidiendoOtros(true);
    try {
      const res = await fetch('/api/regen/ganchos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo');
      await refrescar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPidiendoOtros(false);
    }
  }

  async function lanzar({ ganchoId, titular }: { ganchoId?: string; titular?: string }) {
    setEligiendo(ganchoId || 'manual');
    try {
      const res = await fetch('/api/regen/lanzar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode, ganchoId, titular, brief: brief.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo lanzar');
      (d.avisos || []).forEach((a: string) => toast.error(a));
      toast.success(`Generando ${d.launched} láminas (~$${d.costoEstimado})`);
      setEstado('generando');
      await refrescar();
    } catch (e: any) {
      toast.error(e.message || 'No se pudo lanzar');
    } finally {
      setEligiendo(null);
    }
  }

  async function enviarInstruccion() {
    const t = instruccion.trim();
    if (!t || instruyendo) return;
    setInstruyendo(true);
    try {
      const res = await fetch('/api/regen/instruccion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode, texto: t }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo aplicar');
      if (!d.idxs?.length) toast.info(d.mensaje || 'No entendí qué cambiar');
      else {
        toast.success(d.mensaje);
        setInstruccion('');
        setEstado('generando');
      }
      await refrescar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setInstruyendo(false);
    }
  }

  // Vuelve a generar las láminas indicadas (una del botón 🔁, o todas las pendientes al reanudar).
  async function retirar(indices: number[]) {
    if (!indices.length) return;
    try {
      const res = await fetch('/api/regen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode, indices }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'No se pudo');
      toast.success(
        indices.length === 1 ? `Rehaciendo la lámina ${indices[0] + 1}` : `Rehaciendo ${indices.length} láminas`
      );
      setEstado('generando');
      await refrescar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function descargarZip() {
    if (!plan || dlZip) return;
    setDlZip(true);
    const width = String(plan.length).length;
    const base = (item.creador || 'carrusel').replace(/[^\w.-]/g, '_');
    const payload = plan.map((s) => ({
      url: s.outputUrl || slides[s.idx]?.url || '',
      name: `${String(s.idx + 1).padStart(width, '0')}.${
        s.tipoMedia === 'video' ? 'mp4' : s.accion === 'copiar' ? 'jpg' : 'png'
      }`,
    }));
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
    return <div className="p-12 flex justify-center"><Spinner size={22} /></div>;
  }

  // --- 1 · Arranque: aún no se ha leído ---
  if (!meta?.analisis) {
    return (
      <div className="p-10 text-center max-w-md mx-auto">
        <div className="text-3xl mb-3">🎨</div>
        <h3 className="font-semibold mb-2">Rehacer este carrusel con tu estilo</h3>
        <p className="text-sm text-muted mb-1">
          La IA lee las {slides.length} láminas, entiende de qué van y te propone 5 titulares.
          Eliges uno y hace todo lo demás: escribe el carrusel, lo genera y lo revisa.
        </p>
        {esV1 && (
          <p className="text-xs text-amber-600 mb-1">
            Este carrusel tiene un plan de la versión anterior. Al leerlo se reemplaza.
          </p>
        )}
        <p className="text-xs text-muted mb-5">Leerlo cuesta centavos. Generar, ~$0.07 por lámina.</p>

        <input
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && analizar()}
          placeholder='Algo que pedirle (opcional): "CTA: comenta HOJA"'
          className="w-full h-10 px-3 mb-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-accent"
        />
        <AsyncButton onClick={analizar} loading={analizando} loadingLabel="Leyendo (~1 min)…">
          ✨ Leer el carrusel
        </AsyncButton>
        <div className="mt-3">
          <button onClick={onOpenRefs} className="text-xs text-muted hover:text-accent underline underline-offset-2">
            Gestionar referencias
          </button>
        </div>
      </div>
    );
  }

  // --- 2 · Elegir titular: ya se leyó, no se ha lanzado ---
  if (!meta.ganchoElegido && !trabajando) {
    const aRegenerar = Math.max(1, slides.length - 1);
    return (
      <GanchoSelector
        meta={meta}
        numLaminas={slides.length}
        costoEstimado={Math.round(aRegenerar * 0.07 * 100) / 100}
        onElegir={lanzar}
        onOtros={otrosGanchos}
        eligiendo={eligiendo}
        pidiendoOtros={pidiendoOtros}
      />
    );
  }

  // --- 3 y 4 · Trabajando / resultado ---
  const listos = plan?.filter((s) => s.estado === 'listo').length ?? 0;
  const conAviso = plan?.filter((s) => s.qa && !s.qa.ok).length ?? 0;
  const errores = plan?.filter((s) => s.estado === 'error').length ?? 0;
  const todoListo = !trabajando && !!plan && plan.every((s) => s.estado === 'listo');
  // Job huérfano (p.ej. Railway redesplegó a mitad): sin señales en 15 min → se puede reanudar.
  const colgado =
    trabajando && actualizado != null && Date.now() - new Date(actualizado).getTime() > 15 * 60 * 1000;

  return (
    <div className="p-4">
      <div className="mb-4">
        {meta.ganchoElegido && (
          <div className="text-[13px] font-semibold whitespace-pre-line leading-tight mb-3 text-gray-800">
            «{meta.ganchoElegido.titular}»
          </div>
        )}

        {trabajando && !colgado ? (
          <ProgresoPasos estado={estado} progreso={progreso} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              {colgado ? (
                <span className="text-amber-600">El trabajo se quedó a medias.</span>
              ) : (
                <>
                  ✅ {listos} de {plan?.length ?? 0} láminas
                  {conAviso > 0 && <span className="text-amber-600"> · {conAviso} con aviso</span>}
                  {errores > 0 && <span className="text-red-600"> · {errores} con error</span>}
                </>
              )}
            </span>
            <span className="flex-1" />
            {colgado && (
              <AsyncButton
                onClick={() =>
                  retirar((plan || []).filter((s) => s.accion !== 'copiar' && s.estado !== 'listo').map((s) => s.idx))
                }
                loading={false}
              >
                ▶️ Reanudar
              </AsyncButton>
            )}
            {todoListo && (
              <AsyncButton onClick={descargarZip} loading={dlZip} loadingLabel="Generando ZIP…" variant="secondary">
                ⬇️ Descargar carrusel (.zip)
              </AsyncButton>
            )}
          </div>
        )}
      </div>

      {plan && (
        <GaleriaLaminas
          plan={plan}
          slides={slides}
          shortcode={shortcode}
          bloqueado={trabajando && !colgado}
          onRetirar={(idx) => retirar([idx])}
          onCambio={refrescar}
        />
      )}

      {/* Caja de instrucciones: la forma normal de corregir. */}
      {!trabajando && plan && (
        <div className="mt-4">
          <div className="flex gap-2">
            <input
              value={instruccion}
              onChange={(e) => setInstruccion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviarInstruccion()}
              placeholder='¿Qué le cambio? "la 5 más agresiva y sin la foto" · "cambia el CTA a comenta HOJA"'
              className="flex-1 h-10 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-accent"
            />
            <AsyncButton
              onClick={enviarInstruccion}
              loading={instruyendo}
              loadingLabel="Pensando…"
              disabled={!instruccion.trim()}
            >
              Aplicar
            </AsyncButton>
          </div>
          {!!meta.historial?.length && (
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer select-none">Cambios pedidos ({meta.historial.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {meta.historial.map((h, i) => (
                  <li key={i}>
                    «{h.texto}» → láminas {h.idxs.map((x) => x + 1).join(', ') || '—'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
