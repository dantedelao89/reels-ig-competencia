'use client';

// Reproductor con capturador de frames: se pausa donde interese y se guarda ESE fotograma.
//
// La captura sale en la resolución NATIVA del video (`videoWidth`×`videoHeight`), no en el tamaño
// al que se ve en pantalla, y se exporta en PNG, que no comprime: son exactamente los píxeles que
// decodificó el navegador, sin recompresión. No hay forma de sacar más calidad de ese frame.
//
// El video se sirve por /api/media (nuestro origen) y no directo de R2: un `<video>` de otro
// origen "mancha" el canvas y `toBlob()` lanza SecurityError. Ver el comentario de esa ruta.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from './ui/Toast';

// Sin metadatos de fps fiables, 1/30 s es el paso más útil: cae en el frame vecino tanto en
// videos de 30 fps como de 60 (donde avanza dos), y en los de 24 nunca se salta uno entero.
const PASO_FRAME = 1 / 30;

interface Captura {
  id: string;
  url: string; // blob local
  segundo: number;
  ancho: number;
  alto: number;
  peso: number;
}

interface Props {
  src: string;        // URL del medio (R2 o el CDN original)
  poster?: string | null;
  // Clase de proporción del contenedor. Sin ella el video se dibuja con su tamaño natural, que es
  // lo que quieren los anuncios: conviven cuadrados, verticales y horizontales, y forzarles una
  // proporción los recortaría o los dejaría con franjas.
  ratio?: string;
  nombreBase: string; // p. ej. "IG-DctMqGSDd6R" o "ad_1735139354331160"
}

// 12.34 s → "00-12.34", apto para nombre de archivo y ordenable.
function sello(s: number): string {
  const m = Math.floor(s / 60);
  const seg = (s % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}-${seg}`;
}

export default function FrameCapture({ src, poster, ratio, nombreBase }: Props) {
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [capturas, setCapturas] = useState<Captura[]>([]);
  const [listo, setListo] = useState(false);

  // Las URLs de blob viven hasta que se revocan: sin esto, abrir muchos detalles va acumulando
  // memoria con frames que ya nadie ve.
  useEffect(() => {
    return () => setCapturas((prev) => {
      prev.forEach((c) => URL.revokeObjectURL(c.url));
      return [];
    });
  }, [src]);

  const mover = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.min(Math.max(v.currentTime + delta, 0), v.duration || 0);
  }, []);

  const capturar = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      toast.error('El video aún no ha cargado');
      return;
    }
    v.pause();
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const segundo = v.currentTime;
    canvas.toBlob((blob) => {
      if (!blob) {
        // Pasa si el canvas quedó "manchado": el video no vino de nuestro origen.
        toast.error('No se pudo capturar el frame');
        return;
      }
      setCapturas((prev) => [
        {
          id: `${Date.now()}`,
          url: URL.createObjectURL(blob),
          segundo,
          ancho: canvas.width,
          alto: canvas.height,
          peso: blob.size,
        },
        ...prev,
      ]);
    }, 'image/png'); // PNG: sin pérdida. Un JPEG aquí recomprimiría lo que ya está decodificado.
  }, [toast]);

  function descargar(c: Captura) {
    const a = document.createElement('a');
    a.href = c.url;
    a.download = `${nombreBase}_${sello(c.segundo)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function quitar(c: Captura) {
    URL.revokeObjectURL(c.url);
    setCapturas((prev) => prev.filter((x) => x.id !== c.id));
  }

  // Teclado sobre el reproductor: espacio reproduce/pausa y las flechas avanzan cuadro a cuadro.
  // Va en el contenedor y no en window para no secuestrar las teclas del resto del detalle.
  function onKeyDown(e: React.KeyboardEvent) {
    const v = videoRef.current;
    if (!v) return;
    if (e.key === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); mover(e.shiftKey ? -1 : -PASO_FRAME); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); mover(e.shiftKey ? 1 : PASO_FRAME); }
    else if (e.key.toLowerCase() === 'c') { e.preventDefault(); capturar(); }
  }

  return (
    <div onKeyDown={onKeyDown} tabIndex={-1} className="outline-none">
      {ratio ? (
        <div className={`relative w-full ${ratio} bg-gray-200 rounded-lg overflow-hidden mb-2`}>
          <video
            ref={videoRef}
            src={`/api/media?url=${encodeURIComponent(src)}`}
            poster={poster || undefined}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={() => setListo(true)}
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
        </div>
      ) : (
        <video
          ref={videoRef}
          src={`/api/media?url=${encodeURIComponent(src)}`}
          poster={poster || undefined}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={() => setListo(true)}
          className="w-full rounded-lg bg-black mb-2 max-h-[60vh]"
        />
      )}

      {/* Paso cuadro a cuadro: pausar con el ratón nunca cae donde uno quiere. */}
      <div className="flex items-center gap-1 mb-2">
        <button onClick={() => mover(-1)} className="h-8 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-100" title="Atrás 1 segundo (Shift + ←)">
          ⏪ 1s
        </button>
        <button onClick={() => mover(-PASO_FRAME)} className="h-8 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-100" title="Un cuadro atrás (←)">
          ◀
        </button>
        <button onClick={() => mover(PASO_FRAME)} className="h-8 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-100" title="Un cuadro adelante (→)">
          ▶
        </button>
        <button onClick={() => mover(1)} className="h-8 px-2 text-xs rounded-md border border-line bg-white hover:bg-gray-100" title="Adelante 1 segundo (Shift + →)">
          1s ⏩
        </button>
        <button
          onClick={capturar}
          disabled={!listo}
          className="flex-1 h-8 text-xs rounded-md bg-accent text-white font-medium hover:opacity-90 disabled:opacity-60"
          title="Guardar el fotograma pausado, en la resolución original del video (tecla C)"
        >
          📸 Capturar frame
        </button>
      </div>

      {capturas.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">
            Frames capturados ({capturas.length})
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {capturas.map((c) => (
              <div key={c.id} className="relative group rounded-md overflow-hidden border border-line bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt={`frame en ${c.segundo.toFixed(2)}s`} className="w-full h-auto block" />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[9px] px-1 py-0.5 flex items-center justify-between">
                  <span className="tabular-nums">{sello(c.segundo)}</span>
                  <span>{c.ancho}×{c.alto}</span>
                </div>
                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => descargar(c)}
                    className="text-[11px] px-2 h-7 rounded bg-white text-gray-800 font-medium"
                    title={`Descargar PNG ${c.ancho}×${c.alto} (${Math.round(c.peso / 1024)} KB)`}
                  >
                    ⬇️ PNG
                  </button>
                  <button onClick={() => quitar(c)} className="text-[11px] px-2 h-7 rounded bg-white/90 text-red-600" title="Quitar">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted mt-1">
            PNG sin compresión, en la resolución original del video.
          </p>
        </div>
      )}
    </div>
  );
}
