'use client';

import FacetDropdown from './FacetDropdown';
import DateFilter, { DateState } from './DateFilter';
import PlatformToggle from './PlatformToggle';

interface Facet {
  value: string;
  count: number;
}

interface Props {
  platform: string;
  onPlatform: (v: string) => void;
  facets: { creadores: Facet[]; proyectos: Facet[] } | null;
  creadores: string[];
  proyectos: string[];
  date: DateState;
  origen: string; // '', 'canal', 'busqueda' (solo YouTube)
  onCreadores: (v: string[]) => void;
  onProyectos: (v: string[]) => void;
  onDate: (v: DateState) => void;
  onOrigen: (v: string) => void;
  onClearAll: () => void;
}

const ORIGEN_LABEL: Record<string, string> = { canal: 'Canales', busqueda: 'Búsquedas' };

function chip(label: string, onRemove: () => void, key: string) {
  return (
    <span
      key={key}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-accent bg-accent-soft text-accent text-xs"
    >
      {label}
      <button onClick={onRemove} aria-label="Quitar" className="text-accent/70 hover:text-accent">
        ✕
      </button>
    </span>
  );
}

function dateLabel(d: DateState): string {
  if (!d.desde && !d.hasta) return '';
  const f = d.dateField === 'scrapeado_en' ? 'Scrapeado' : 'Publicación';
  const a = d.desde ? d.desde.slice(0, 10) : '…';
  const b = d.hasta ? d.hasta.slice(0, 10) : '…';
  return a === b ? `${f}: ${a}` : `${f}: ${a} → ${b}`;
}

export default function FilterBar(p: Props) {
  const anyActive = p.creadores.length || p.proyectos.length || p.date.desde || p.date.hasta || p.origen;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformToggle platform={p.platform} onPlatform={p.onPlatform} />
        {/* Origen: solo aplica a YouTube (canal vs búsqueda). Se oculta si el filtro es solo Instagram. */}
        {p.platform !== 'ig' && (
          <div className="flex items-center bg-gray-100 rounded-md p-0.5 text-xs" title="Cómo se scrapeó el video de YouTube">
            {[
              ['', 'Todo origen'],
              ['canal', 'Canales'],
              ['busqueda', 'Búsquedas'],
            ].map(([v, l]) => (
              <button
                key={v}
                onClick={() => p.onOrigen(v)}
                className={`px-2.5 h-7 rounded ${p.origen === v ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <span className="w-px h-6 bg-line mx-1 hidden sm:block" />
        <FacetDropdown
          label="Creador"
          options={p.facets?.creadores || []}
          selected={p.creadores}
          onChange={p.onCreadores}
        />
        <FacetDropdown
          label="Proyecto"
          options={p.facets?.proyectos || []}
          selected={p.proyectos}
          onChange={p.onProyectos}
        />
        <DateFilter value={p.date} onChange={p.onDate} />
        {anyActive ? (
          <button onClick={p.onClearAll} className="text-xs text-muted hover:text-gray-700 h-8 px-2 ml-1">
            Limpiar todo
          </button>
        ) : null}
      </div>

      {anyActive ? (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {p.creadores.map((c) =>
            chip(`Creador: ${c}`, () => p.onCreadores(p.creadores.filter((x) => x !== c)), `c-${c}`)
          )}
          {p.proyectos.map((c) =>
            chip(`Proyecto: ${c}`, () => p.onProyectos(p.proyectos.filter((x) => x !== c)), `p-${c}`)
          )}
          {(p.date.desde || p.date.hasta) &&
            chip(dateLabel(p.date), () => p.onDate({ ...p.date, desde: '', hasta: '' }), 'date')}
          {p.origen && chip(`Origen: ${ORIGEN_LABEL[p.origen] || p.origen}`, () => p.onOrigen(''), 'origen')}
        </div>
      ) : null}
    </div>
  );
}
