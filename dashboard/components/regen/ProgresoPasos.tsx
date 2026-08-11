'use client';

// Los pasos del trabajo, para que se vea qué está haciendo la IA en cada momento.

import type { RegenProgreso } from '@/lib/types';
import Spinner from '../ui/Spinner';
import ProgressBar from '../ui/ProgressBar';

const PASOS = [
  { key: 'leyendo', label: 'Leyendo el carrusel' },
  { key: 'ganchos', label: 'Escribiendo titulares' },
  { key: 'escribiendo', label: 'Escribiendo el guion' },
  { key: 'generando', label: 'Generando láminas' },
  { key: 'revisando', label: 'Revisando' },
];

export default function ProgresoPasos({
  estado,
  progreso,
  concurrencia = 3,
}: {
  estado: string | null;
  progreso: RegenProgreso | null;
  concurrencia?: number;
}) {
  // 'revisando' ocurre dentro de la generación: se muestra como sub-estado, no como paso aparte.
  const actual = estado === 'revisando' ? 'generando' : estado;
  const iActual = PASOS.findIndex((p) => p.key === actual);
  const hechos = progreso?.hechos ?? 0;
  const total = progreso?.total ?? 0;
  const restantes = Math.max(0, total - hechos);
  // Cada lámina tarda 3-6 min y corren `concurrencia` a la vez.
  const minutos = total ? Math.ceil((restantes * 4.5) / concurrencia) : 0;

  return (
    <div className="space-y-1.5">
      {PASOS.map((p, i) => {
        const hecho = iActual > i;
        const enCurso = iActual === i;
        if (!hecho && !enCurso) return null;
        return (
          <div key={p.key} className="flex items-center gap-2 text-sm">
            {hecho ? (
              <span className="text-green-600">✓</span>
            ) : (
              <Spinner size={13} />
            )}
            <span className={hecho ? 'text-muted' : 'text-gray-800 font-medium'}>{p.label}</span>
            {enCurso && p.key === 'generando' && total > 0 && (
              <>
                <span className="text-xs text-muted tabular-nums">{hechos}/{total}</span>
                {minutos > 0 && <span className="text-xs text-muted">· ~{minutos} min</span>}
              </>
            )}
            {enCurso && estado === 'revisando' && progreso?.mensaje && (
              <span className="text-xs text-muted">· {progreso.mensaje}</span>
            )}
          </div>
        );
      })}
      {actual === 'generando' && total > 0 && (
        <div className="pt-1">
          <ProgressBar value={Math.round((hechos / total) * 100)} />
        </div>
      )}
    </div>
  );
}
