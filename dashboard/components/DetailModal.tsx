'use client';

import { useRef, useState } from 'react';
import type { ContentItem, Estado } from '@/lib/types';
import { ESTADOS } from '@/lib/types';
import { fmtNum, fmtDateShort } from '@/lib/format';

interface Props {
  item: ContentItem;
  onClose: () => void;
  onEstado: (item: ContentItem, estado: Estado) => void;
  onSaveProduction: (item: ContentItem, fields: { mi_guion: string; mi_notas: string; mi_link: string }) => Promise<void>;
  onUploaded: () => void;
}

export default function DetailModal({ item, onClose, onEstado, onSaveProduction, onUploaded }: Props) {
  const [guion, setGuion] = useState(item.miGuion || '');
  const [notas, setNotas] = useState(item.miNotas || '');
  const [link, setLink] = useState(item.miLink || '');
  const [videoUrl, setVideoUrl] = useState(item.miVideoUrl || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    setSaving(true);
    setSavedMsg('');
    await onSaveProduction(item, { mi_guion: guion, mi_notas: notas, mi_link: link });
    setSaving(false);
    setSavedMsg('Guardado');
    setTimeout(() => setSavedMsg(''), 2000);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('id', item.id);
    fd.append('platform', item.platform);
    fd.append('externalId', item.externalId);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al subir');
      setVideoUrl(data.url);
      onUploaded();
    } catch (err: any) {
      setUploadErr(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="bg-white w-full max-w-4xl rounded-2xl overflow-hidden my-8" onClick={(e) => e.stopPropagation()}>
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
                <option key={e.key} value={e.key}>{e.label}</option>
              ))}
            </select>
            <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-gray-100" aria-label="Cerrar">✕</button>
          </div>
        </div>

        <div className="grid md:grid-cols-[220px_1fr]">
          <div className="p-4 border-r border-line bg-gray-50">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-2">Referencia</div>
            <div className={`relative w-full ${item.platform === 'ig' ? 'pt-[133%]' : 'pt-[56%]'} bg-gray-200 rounded-lg overflow-hidden mb-2`}>
              {item.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
            </div>
            {item.thumbnail && (
              <a href={item.thumbnail} download className="block w-full text-center text-xs h-8 leading-8 rounded-md border border-line mb-1.5 hover:bg-white">Descargar thumbnail</a>
            )}
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="block w-full text-center text-xs h-8 leading-8 rounded-md border border-line hover:bg-white">Ver original ↗</a>
            )}
            <div className="text-xs text-muted mt-3 space-y-1">
              <div>▶ {fmtNum(item.views)} vistas</div>
              {item.likes != null && <div>♥ {fmtNum(item.likes)} likes</div>}
              <div>📅 {fmtDateShort(item.fechaPublicacion)}</div>
              {item.proyecto && <div>📁 {item.proyecto}</div>}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted mt-4 mb-1">
              {item.platform === 'ig' ? 'Transcripción' : 'Subtítulos'}
            </div>
            <div className="text-xs text-gray-700 whitespace-pre-wrap max-h-44 overflow-y-auto">
              {item.transcripcion || <span className="text-muted">Sin transcripción.</span>}
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-2">Mi versión</div>

            <label className="text-xs text-muted block mb-1">Guión</label>
            <textarea
              value={guion}
              onChange={(e) => setGuion(e.target.value)}
              placeholder="Escribe o pega aquí tu adaptación del guión…"
              className="w-full min-h-[120px] text-sm border border-line rounded-md p-2 mb-3 outline-none focus:border-accent resize-y"
            />

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-muted block mb-1">Video final</label>
                {videoUrl ? (
                  <div>
                    <video src={videoUrl} controls className="w-full rounded-md bg-black max-h-40 mb-1" />
                    <div className="flex gap-2">
                      <a href={videoUrl} target="_blank" rel="noreferrer" className="text-xs text-accent">Abrir ↗</a>
                      <button onClick={() => fileRef.current?.click()} className="text-xs text-muted hover:text-gray-700">Reemplazar</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="w-full border border-dashed border-line rounded-md py-5 text-center text-muted hover:bg-gray-50 disabled:opacity-60"
                  >
                    <div className="text-lg">↑</div>
                    <div className="text-xs mt-1">{uploading ? 'Subiendo…' : 'Subir mi video (R2)'}</div>
                  </button>
                )}
                {uploadErr && <p className="text-xs text-red-600 mt-1">{uploadErr}</p>}
                <input ref={fileRef} type="file" accept="video/*" onChange={onPickFile} className="hidden" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Notas</label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Ideas, ángulo, fecha de publicación…"
                  className="w-full min-h-[96px] text-sm border border-line rounded-md p-2 outline-none focus:border-accent resize-y"
                />
              </div>
            </div>

            <label className="text-xs text-muted block mb-1">Link (Drive / Notion, opcional)</label>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              className="w-full h-9 text-sm border border-line rounded-md px-2 mb-4 outline-none focus:border-accent"
            />

            <div className="flex items-center justify-end gap-3">
              {savedMsg && <span className="text-xs text-green-600">{savedMsg}</span>}
              <button onClick={save} disabled={saving} className="h-9 px-4 text-sm rounded-md bg-ink text-white disabled:opacity-60">
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
