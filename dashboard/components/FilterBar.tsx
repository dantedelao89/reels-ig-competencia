'use client';

import FacetDropdown from './FacetDropdown';
import DateFilter, { DateState } from './DateFilter';

interface Facet {
  value: string;
  count: number;
}

interface Props {
  facets: { creadores: Facet[]; proyectos: Facet[] } | null;
  creadores: string[];
  proyectos: string[];
  date: DateState;
  onCreadores: (v: string[]) => void;
  onProyectos: (v: string[]) => void;
  onDate: (v: DateState) => void;
  onClearAll: () => void;
}

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
  const anyActive = p.creadores.length || p.proyectos.length || p.date.desde || p.date.hasta;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
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
        </div>
      ) : null}
    </div>
  );
}
