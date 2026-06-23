'use client';

interface Props {
  q: string;
  onQ: (v: string) => void;
  platform: string;
  onPlatform: (v: string) => void;
  sort: string;
  dir: string;
  onSort: (field: string, dir: string) => void;
  view: 'grid' | 'table';
  onView: (v: 'grid' | 'table') => void;
  total: number;
  igCount?: number;
  ytCount?: number;
}

const SORTS: { field: string; label: string }[] = [
  { field: 'fecha_publicacion', label: 'Fecha de publicación' },
  { field: 'scrapeado_en', label: 'Fecha de scrapeo' },
  { field: 'views', label: 'Vistas' },
  { field: 'engagement', label: 'Engagement' },
];

export default function Topbar(p: Props) {
  const seg = (key: string, label: string) => (
    <button
      onClick={() => p.onPlatform(key)}
      className={`px-3 h-8 text-sm rounded-md ${
        p.platform === key ? 'bg-white shadow-sm font-medium' : 'text-muted'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">⌕</span>
          <input
            value={p.q}
            onChange={(e) => p.onQ(e.target.value)}
            placeholder="Buscar en captions y transcripciones…"
            className="w-full h-10 pl-8 pr-3 rounded-lg border border-line bg-white outline-none focus:border-accent text-sm"
          />
        </div>

        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          {seg('all', 'Todo')}
          {seg('ig', 'Instagram')}
          {seg('yt', 'YouTube')}
        </div>

        <div className="flex border border-line rounded-lg overflow-hidden bg-white">
          <button
            onClick={() => p.onView('grid')}
            className={`px-3 h-10 text-sm ${p.view === 'grid' ? 'bg-gray-100 font-medium' : ''}`}
            aria-label="Cuadrícula"
          >
            ▦
          </button>
          <button
            onClick={() => p.onView('table')}
            className={`px-3 h-10 text-sm border-l border-line ${
              p.view === 'table' ? 'bg-gray-100 font-medium' : ''
            }`}
            aria-label="Tabla"
          >
            ▤
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted">
          {p.total.toLocaleString('es-MX')} resultados
          {p.igCount != null && p.ytCount != null && (
            <span className="ml-2 text-muted/70">
              · {p.igCount} IG · {p.ytCount} YT
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={p.sort}
            onChange={(e) => p.onSort(e.target.value, p.dir)}
            className="h-8 text-sm rounded-md border border-line bg-white px-2"
          >
            {SORTS.map((s) => (
              <option key={s.field} value={s.field}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => p.onSort(p.sort, p.dir === 'desc' ? 'asc' : 'desc')}
            className="h-8 px-2 text-sm rounded-md border border-line bg-white"
            title={p.dir === 'desc' ? 'Descendente' : 'Ascendente'}
          >
            {p.dir === 'desc' ? '↓ Más' : '↑ Menos'}
          </button>
        </div>
      </div>
    </div>
  );
}
