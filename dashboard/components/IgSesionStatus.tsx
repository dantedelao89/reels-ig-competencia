'use client';

import { useCallback, useEffect, useState } from 'react';

// Estado de la sesión de Instagram montada en el scraper, la que sirve para los reels limitados por
// edad. Se pinta AQUÍ y no solo en Railway porque es estado que cambia solo: una cookie caduca o
// Instagram marca la cuenta sin que nadie toque nada, y entonces vuelven a fallar justo los reels
// que la sesión vino a arreglar. Si viviera solo en una variable, ese día se vería como «el scraper
// se rompió otra vez» y volveríamos a buscar donde no es.
//
// Nunca muestra la cookie: el scraper no la devuelve. Lo que se ve es si está montada, cómo le fue
// la última vez y con qué cuenta — eso último para notar de un vistazo que la cuenta montada es la
// desechable y no la cuenta real.

interface Estado {
  montada: boolean;
  variableRecibida: string | null;
  estado: 'sin_usar' | 'ok' | 'caducada' | 'cuenta_marcada' | 'frenada' | 'error';
  cuando: string | null;
  detalle: string | null;
}

// Cada estado dice qué hacer, no solo qué pasó. `accion` es null cuando no hay nada que hacer.
const LETREROS: Record<Estado['estado'], { punto: string; texto: string; accion: string | null }> = {
  ok: { punto: 'bg-green-500', texto: 'Sesión viva', accion: null },
  sin_usar: { punto: 'bg-gray-400', texto: 'Montada, sin usar todavía', accion: null },
  caducada: {
    punto: 'bg-red-500',
    texto: 'Sesión caducada',
    accion: 'Saca una sessionid nueva y pégala en IG_SESSIONID (Railway → reels-ig-competencia).',
  },
  cuenta_marcada: {
    punto: 'bg-red-500',
    texto: 'Instagram marcó la cuenta',
    accion: 'Entra a esa cuenta desde el teléfono y pasa la verificación, o crea otra desechable.',
  },
  frenada: {
    punto: 'bg-amber-500',
    texto: 'Instagram frenó la cuenta por ritmo',
    accion: 'No es un error del scraper. Espera unos minutos.',
  },
  error: { punto: 'bg-amber-500', texto: 'No pude comprobarla', accion: null },
};

const cuando = (iso: string | null) => {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
};

export default function IgSesionStatus() {
  const [d, setD] = useState<Estado | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    fetch('/api/ig-sesion', { cache: 'no-store' })
      .then((r) => r.json())
      .then((x) => (x.error ? setErr(x.error) : setD(x)))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  const l = d ? LETREROS[d.estado] ?? LETREROS.error : null;

  return (
    <div className="mt-3 rounded-lg border border-line bg-gray-50 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">Sesión de Instagram</span>
        <button onClick={load} title="Comprobar contra Instagram" className="text-muted hover:text-gray-700 text-xs leading-none">
          ↻
        </button>
      </div>

      {loading && !d ? (
        <div className="text-xs text-muted">Comprobando…</div>
      ) : err ? (
        <div className="text-xs text-red-600 break-words">Error: {err}</div>
      ) : d && !d.montada ? (
        // Sin sesión el scraper funciona igual: lo único que no se puede guardar es el contenido
        // limitado por edad. Así que esto no es una alarma, es una capacidad apagada.
        <div className="text-[11px] text-muted leading-relaxed">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
            <span className="text-xs font-medium text-gray-700">Sin montar</span>
          </div>
          Los reels limitados por edad no se pueden guardar. Todo lo demás funciona igual. Se monta
          con <code className="rounded bg-gray-200 px-1">IG_SESSIONID</code> en Railway.
        </div>
      ) : d && l ? (
        <>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${l.punto} shrink-0`} />
            <span className="text-xs font-medium text-gray-700">{l.texto}</span>
          </div>
          {d.detalle ? (
            <div className="text-[11px] text-muted break-words">
              {d.detalle}
              {d.cuando ? <span className="text-gray-400"> · {cuando(d.cuando)}</span> : null}
            </div>
          ) : null}
          {l.accion ? <div className="mt-1 text-[11px] text-gray-700 leading-relaxed">{l.accion}</div> : null}
        </>
      ) : null}
    </div>
  );
}
