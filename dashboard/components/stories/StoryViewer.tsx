'use client';

// Visor secuencial de historias, como se ven en Instagram: barras de progreso arriba, avance con
// clic o teclado, y la hora real de publicación siempre a la vista.
//
// El índice va sobre el array PLANO ya ordenado (día desc, hora asc), así que al llegar al final
// de un día entra solo en el día anterior sin ninguna lógica extra.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { fmtDiaRel, fmtHora } from '@/lib/format';
import type { Story } from '../StoriesView';

export default function StoryViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: Story[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const actual = items[index];
  const videoRef = useRef<HTMLVideoElement>(null);

  const siguiente = useCallback(() => {
    if (index < items.length - 1) onIndex(index + 1);
    else onClose(); // se acabó el archivo
  }, [index, items.length, onIndex, onClose]);

  const anterior = useCallback(() => {
    if (index > 0) onIndex(index - 1);
  }, [index, onIndex]);

  // Salto de día: al primero del día anterior / siguiente.
  const saltarDia = useCallback(
    (dir: 1 | -1) => {
      const dia = actual?.dia;
      if (!dia) return;
      if (dir === 1) {
        const i = items.findIndex((s, k) => k > index && s.dia !== dia);
        if (i >= 0) onIndex(i);
      } else {
        const anteriores = items.slice(0, index).map((s) => s.dia);
        const otroDia = [...anteriores].reverse().find((d) => d !== dia);
        if (otroDia) onIndex(items.findIndex((s) => s.dia === otroDia));
      }
    },
    [actual, items, index, onIndex]
  );

  // Teclado: es lo que hace que revisar 60 historias no sea un suplicio de clics.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); return siguiente(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); return anterior(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); return saltarDia(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); return saltarDia(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [siguiente, anterior, saltarDia, onClose]);

  // Bloquea el scroll del fondo mientras el visor está abierto.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  // Posición dentro del día (lo que importa: "la 3 de 13 de ese día", no del archivo entero).
  const { delDia, posEnDia } = useMemo(() => {
    const delDia = items.filter((s) => s.dia === actual?.dia);
    return { delDia, posEnDia: delDia.findIndex((s) => s.id === actual?.id) };
  }, [items, actual]);

  if (!actual) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" role="dialog" aria-modal="true">
      {/* Barras de progreso del día */}
      <div className="flex gap-1 px-3 pt-3 shrink-0">
        {delDia.map((s, i) => (
          <span key={s.id} className="h-0.5 flex-1 rounded-full bg-white/30 overflow-hidden">
            <span className={`block h-full bg-white ${i <= posEnDia ? 'w-full' : 'w-0'}`} />
          </span>
        ))}
      </div>

      {/* Cabecera */}
      <div className="flex items-center gap-2 px-4 py-2.5 text-white shrink-0">
        <span className="font-medium text-sm">@{actual.creador}</span>
        <span className="text-xs text-white/60 capitalize">{fmtDiaRel(actual.dia)}</span>
        <span className="text-xs text-white/90 tabular-nums">{fmtHora(actual.fechaPublicacion)}</span>
        <span className="text-xs text-white/50 tabular-nums">
          {posEnDia + 1}/{delDia.length}
        </span>
        <span className="flex-1" />
        <span className="hidden md:inline text-[11px] text-white/40">← → avanzar · ↑ ↓ cambiar de día · Esc salir</span>
        <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/80" aria-label="Cerrar">✕</button>
      </div>

      {/* Media */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        {actual.mediaUrl ? (
          actual.tipo === 'video' ? (
            <video
              ref={videoRef}
              key={actual.mediaUrl}
              src={actual.mediaUrl}
              poster={actual.posterUrl || undefined}
              autoPlay
              playsInline
              controls
              onEnded={siguiente}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={actual.mediaUrl} src={actual.mediaUrl} alt="" className="max-h-full max-w-full object-contain" />
          )
        ) : (
          <div className="text-center text-white/70 px-8">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm">Esta historia no se pudo archivar.</p>
            <p className="text-xs text-white/50 mt-1">{actual.mediaError}</p>
            <p className="text-xs text-white/40 mt-3">
              Se conserva su hora ({fmtHora(actual.fechaPublicacion)}) para que no falte en la secuencia.
            </p>
          </div>
        )}

        {/* Zonas de clic, como en Instagram. El centro queda libre para los controles del video. */}
        <button onClick={anterior} className="absolute inset-y-0 left-0 w-[28%] cursor-w-resize" aria-label="Anterior" />
        <button onClick={siguiente} className="absolute inset-y-0 right-0 w-[28%] cursor-e-resize" aria-label="Siguiente" />

        {index > 0 && (
          <button
            onClick={anterior}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white hidden md:flex items-center justify-center"
            aria-label="Anterior"
          >
            ‹
          </button>
        )}
        {index < items.length - 1 && (
          <button
            onClick={siguiente}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white hidden md:flex items-center justify-center"
            aria-label="Siguiente"
          >
            ›
          </button>
        )}
      </div>

      <div className="flex justify-center gap-4 py-3 shrink-0 text-xs">
        {actual.mediaUrl && (
          <a href={actual.mediaUrl} download target="_blank" rel="noreferrer" className="text-white/70 hover:text-white">
            ⬇️ Descargar
          </a>
        )}
      </div>
    </div>
  );
}
