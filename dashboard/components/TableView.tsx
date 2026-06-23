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

export default function TableView({ items, selected, onToggle, onOpen }: Props) {
  return (
    <div className="border border-line rounded-xl overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-muted text-xs">
            <th className="w-9 p-2"></th>
            <th className="w-14 p-2"></th>
            <th className="text-left p-2 font-medium">Título</th>
            <th className="text-left p-2 font-medium w-32">Creador</th>
            <th className="text-left p-2 font-medium w-14">Plat.</th>
            <th className="text-right p-2 font-medium w-20">Vistas</th>
            <th className="text-left p-2 font-medium w-24">Fecha</th>
            <th className="text-left p-2 font-medium w-28">Estado</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const sel = selected.has(it.id);
            const est = ESTADO_STYLE[it.estado];
            return (
              <tr key={it.id} className="border-t border-line hover:bg-gray-50">
                <td className="p-2 text-center">
                  <input type="checkbox" checked={sel} onChange={() => onToggle(it.id)} />
                </td>
                <td className="p-2">
                  <div className="w-10 h-10 rounded-md bg-gray-200 overflow-hidden">
                    {it.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
                    )}
                  </div>
                </td>
                <td className="p-2 align-top">
                  <button onClick={() => onOpen(it)} className="block text-left hover:text-accent line-clamp-2 break-words">
                    {it.titulo || '(sin texto)'}
                  </button>
                </td>
                <td className="p-2 text-muted align-top whitespace-nowrap">{it.creador ? `@${it.creador}` : '—'}</td>
                <td className="p-2 text-muted">{it.platform === 'ig' ? 'IG' : 'YT'}</td>
                <td className="p-2 text-right tabular-nums">{fmtNum(it.views)}</td>
                <td className="p-2 text-muted whitespace-nowrap">{fmtDateShort(it.fechaPublicacion)}</td>
                <td className="p-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${est.cls}`}>{est.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
