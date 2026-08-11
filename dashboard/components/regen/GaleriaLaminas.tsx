'use client';

// Galería de las láminas del carrusel. Se usa igual mientras se generan (huecos que se van
// llenando) y al final (resultado). Cada tarjeta esconde su ⚙️ detalle para los ajustes finos.

import { useState } from 'react';
import type { CarouselSlide, RegenSlide } from '@/lib/types';
import Spinner from '../ui/Spinner';
import SlideDetalle from './SlideDetalle';

export default function GaleriaLaminas({
  plan,
  slides,
  shortcode,
  bloqueado,
  onRetirar,
  onCambio,
}: {
  plan: RegenSlide[];
  slides: CarouselSlide[];
  shortcode: string;
  bloqueado: boolean;
  onRetirar: (idx: number) => void;
  onCambio: () => void;
}) {
  const [abierto, setAbierto] = useState<number | null>(null);

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
      {plan.map((s) => {
        const original = slides[s.idx];
        const copiado = s.accion === 'copiar';
        const url = s.outputUrl || (copiado ? original?.url : null);
        const esVideo = s.tipoMedia === 'video';
        const aviso = s.qa && !s.qa.ok;

        return (
          <div key={s.idx}>
            <div className="relative w-full pt-[125%] rounded-lg overflow-hidden bg-gray-100 border border-line group">
              {s.estado === 'generando' ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
                  <Spinner size={20} />
                  <span className="text-[10px]">generando…</span>
                </span>
              ) : s.estado === 'error' ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
                  <span className="text-red-400 text-lg">✕</span>
                  <span className="text-[9px] text-red-600 leading-tight line-clamp-3">{s.error}</span>
                </span>
              ) : url ? (
                esVideo ? (
                  <video src={url} poster={original?.poster || undefined} controls playsInline className="absolute inset-0 w-full h-full object-cover bg-black" />
                ) : (
                  <a href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Lámina ${s.idx + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                  </a>
                )
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-2xl text-gray-300 font-semibold">
                  {s.idx + 1}
                </span>
              )}

              <span className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                {s.idx + 1}
              </span>
              {copiado && (
                <span className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                  {esVideo ? 'video' : 'original'}
                </span>
              )}
              {aviso && (
                <span
                  className="absolute bottom-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white"
                  title={s.qa!.problemas.join(' · ')}
                >
                  ⚠️ revisar
                </span>
              )}
              {!bloqueado && s.estado === 'listo' && !copiado && (
                <button
                  onClick={() => onRetirar(s.idx)}
                  className="absolute bottom-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Volver a generar esta lámina"
                >
                  🔁
                </button>
              )}
            </div>

            <button
              onClick={() => setAbierto(abierto === s.idx ? null : s.idx)}
              className="mt-1 w-full text-left text-[10px] text-muted hover:text-gray-700 truncate"
              title={s.textoNuevo || undefined}
            >
              ⚙️ {s.rol}
              {s.qa?.problemas?.length ? <span className="text-amber-600"> · {s.qa.problemas[0]}</span> : null}
            </button>

            {abierto === s.idx && (
              <SlideDetalle
                slide={s}
                shortcode={shortcode}
                bloqueado={bloqueado}
                onCerrar={() => setAbierto(null)}
                onRetirar={() => onRetirar(s.idx)}
                onCambio={onCambio}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
