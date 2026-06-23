'use client';

import type { ContentItem, Estado } from '@/lib/types';
import { ESTADOS } from '@/lib/types';
import { fmtNum, fmtDateShort } from '@/lib/format';

interface Props {
  item: ContentItem;
  onClose: () => void;
  onEstado: (item: ContentItem, estado: Estado) => void;
}

export default function DetailModal({ item, onClose, onEstado }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl rounded-2xl overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="font-medium">{item.creador ? `@${item.creador}` : '—'}</span>
            <span className="text-xs text-muted">{item.platform === 'ig' ? 'Instagram' : 'YouTube'}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={item.estado}
              onChange={(e) => onEstado(item, e.target.value as Estado)}
              className="h-8 text-sm rounded-md border border-line px-2"
            >
              {ESTADOS.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </select>
            <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-gray-100" aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-[200px_1fr]">
          <div className="p-4 border-r border-line bg-gray-50">
            <div
              className={`relative w-full ${
                item.platform === 'ig' ? 'pt-[133%]' : 'pt-[56%]'
              } bg-gray-200 rounded-lg overflow-hidden mb-3`}
            >
              {item.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
            </div>
            {item.thumbnail && (
              <a
                href={item.thumbnail}
                download
                className="block w-full text-center text-xs h-8 leading-8 rounded-md border border-line mb-1.5 hover:bg-white"
              >
                Descargar thumbnail
              </a>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block w-full text-center text-xs h-8 leading-8 rounded-md border border-line hover:bg-white"
              >
                Ver original ↗
              </a>
            )}
            <div className="text-xs text-muted mt-3 space-y-1">
              <div>▶ {fmtNum(item.views)} vistas</div>
              {item.likes != null && <div>♥ {fmtNum(item.likes)} likes</div>}
              {item.comentarios != null && <div>💬 {fmtNum(item.comentarios)} coment.</div>}
              <div>📅 {fmtDateShort(item.fechaPublicacion)}</div>
              {item.proyecto && <div>📁 {item.proyecto}</div>}
            </div>
          </div>

          <div className="p-4">
            {item.titulo && <p className="text-sm mb-3 whitespace-pre-wrap">{item.titulo}</p>}
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1">
              {item.platform === 'ig' ? 'Transcripción' : 'Subtítulos'}
            </div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
              {item.transcripcion || <span className="text-muted">Sin transcripción.</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
