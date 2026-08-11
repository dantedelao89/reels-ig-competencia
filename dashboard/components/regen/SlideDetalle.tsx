'use client';

// Los ajustes finos de UNA lámina. Vive colapsado: el flujo normal es hablarle a la caja de
// instrucciones, no venir aquí. Está para el caso raro en que Dante quiera tocar algo exacto.

import { useState } from 'react';
import type { RegenSlide } from '@/lib/types';
import { useToast } from '../ui/Toast';

export default function SlideDetalle({
  slide,
  shortcode,
  bloqueado,
  onCerrar,
  onRetirar,
  onCambio,
}: {
  slide: RegenSlide;
  shortcode: string;
  bloqueado: boolean;
  onCerrar: () => void;
  onRetirar: () => void;
  onCambio: () => void;
}) {
  const toast = useToast();
  const [textos, setTextos] = useState((slide.textos || []).join('\n'));
  const [foto, setFoto] = useState(slide.foto || '');
  const [nota, setNota] = useState(slide.nota || '');

  async function guardar(patch: Record<string, unknown>) {
    try {
      const res = await fetch('/api/regen/slide', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode, idx: slide.idx, patch }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo guardar');
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="mt-1 p-2.5 rounded-lg border border-line bg-gray-50 text-[11px] space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-700">
          Lámina {slide.idx + 1} · {slide.accion}
          {slide.modelo ? ` · ${slide.modelo}` : ''}
        </span>
        <button onClick={onCerrar} className="text-muted hover:text-gray-700">✕</button>
      </div>

      {slide.qa && !slide.qa.ok && (
        <div className="text-amber-700 bg-amber-50 rounded p-1.5">
          {slide.qa.problemas.map((p, i) => <div key={i}>⚠️ {p}</div>)}
        </div>
      )}

      {slide.accion === 'regenerar' && (
        <>
          <label className="block">
            <span className="text-muted">Texto de la lámina (una línea por bloque)</span>
            <textarea
              value={textos}
              disabled={bloqueado}
              onChange={(e) => setTextos(e.target.value)}
              onBlur={() => {
                const arr = textos.split('\n').map((t) => t.trim()).filter(Boolean);
                guardar({ textos: arr, textoNuevo: arr.join('\n') || null });
              }}
              rows={4}
              className="w-full mt-0.5 border border-line rounded p-1.5 bg-white outline-none focus:border-accent resize-y disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="text-muted">Fotografía</span>
            <textarea
              value={foto}
              disabled={bloqueado}
              onChange={(e) => setFoto(e.target.value)}
              onBlur={() => guardar({ foto: foto.trim() || null })}
              rows={2}
              className="w-full mt-0.5 border border-line rounded p-1.5 bg-white outline-none focus:border-accent resize-y disabled:opacity-60"
            />
          </label>
        </>
      )}

      <label className="block">
        <span className="text-muted">Nota extra para el generador</span>
        <input
          value={nota}
          disabled={bloqueado}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => guardar({ nota: nota.trim() || null })}
          className="w-full mt-0.5 h-7 px-1.5 border border-line rounded bg-white outline-none focus:border-accent disabled:opacity-60"
        />
      </label>

      {slide.prompt && (
        <details>
          <summary className="text-muted cursor-pointer select-none">Prompt completo</summary>
          <pre className="mt-1 p-1.5 bg-white border border-line rounded max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-snug">
            {slide.prompt}
          </pre>
        </details>
      )}

      {!bloqueado && slide.accion !== 'copiar' && (
        <button
          onClick={onRetirar}
          className="w-full h-7 rounded border border-line bg-white hover:bg-gray-100 text-gray-700"
        >
          🔁 Volver a generar esta lámina
        </button>
      )}
    </div>
  );
}
