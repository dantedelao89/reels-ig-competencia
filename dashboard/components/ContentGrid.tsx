'use client';

import type { ContentItem } from '@/lib/types';
import { fmtNum, fmtDateShort } from '@/lib/format';
import { ESTADO_STYLE } from '@/lib/estados';

interface Props {
  items: ContentItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (item: ContentItem) => void;
}

function Thumb({ item }: { item: ContentItem }) {
  const ratio = item.platform === 'ig' ? 'pt-[133%]' : 'pt-[56%]';
  return (
    <div className={`relative w-full ${ratio} bg-gray-200`}>
      {item.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbnail}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">
          sin imagen
        </div>
      )}
      <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">
        {item.platform === 'ig' ? 'IG' : 'YT'}
      </span>
      {item.duracion && (
        <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white tabular-nums">
          {item.duracion}
        </span>
      )}
    </div>
  );
}

export default function ContentGrid({ items, selected, onToggle, onOpen }: Props) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
      {items.map((it) => {
        const sel = selected.has(it.id);
        const est = ESTADO_STYLE[it.estado];
        return (
          <div
            key={it.id}
            className={`group relative bg-white rounded-xl overflow-hidden border transition-shadow hover:shadow-sm ${
              sel ? 'border-accent ring-1 ring-accent' : 'border-line'
            }`}
          >
            <button
              onClick={() => onToggle(it.id)}
              aria-label="Seleccionar"
              className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-[5px] flex items-center justify-center text-[11px] ${
                sel ? 'bg-accent text-white' : 'bg-black/45 text-transparent group-hover:text-white/80'
              }`}
            >
              ✓
            </button>

            <button onClick={() => onOpen(it)} className="block w-full text-left">
              <Thumb item={it} />
            </button>

            <div className="p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${est.cls}`}>
                  {est.label}
                </span>
                <span className="text-[11px] text-muted">{it.creador ? `@${it.creador}` : '—'}</span>
              </div>
              <button
                onClick={() => onOpen(it)}
                className="block text-[13px] leading-snug text-left mb-2 hover:text-accent line-clamp-2 break-words w-full"
              >
                {it.titulo || '(sin texto)'}
              </button>
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden="true">📅</span> {fmtDateShort(it.fechaPublicacion)}
                </span>
                <span className="inline-flex gap-2.5 tabular-nums">
                  <span>▶ {fmtNum(it.views)}</span>
                  {it.likes != null && <span>♥ {fmtNum(it.likes)}</span>}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
