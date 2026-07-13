'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentItem, Estado } from '@/lib/types';
import { ESTADOS } from '@/lib/types';
import { fmtNum, fmtDateShort, toParagraphs } from '@/lib/format';

interface Props {
  item: ContentItem;
  onClose: () => void;
  onEstado: (item: ContentItem, estado: Estado) => void;
  onSaveProduction: (item: ContentItem, fields: { mi_guion: string; mi_notas: string; mi_link: string }) => Promise<void>;
  onUploaded: () => void;
}

export default function DetailModal({ item, onClose, onEstado, onSaveProduction, onUploaded }: Props) {
  const [tab, setTab] = useState<'detalle' | 'miversion'>('detalle');

  const [guion, setGuion] = useState(item.miGuion || '');
  const [notas, setNotas] = useState(item.miNotas || '');
  const [link, setLink] = useState(item.miLink || '');
  const [videoUrl, setVideoUrl] = useState(item.miVideoUrl || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [transcripcion, setTranscripcion] = useState(item.transcripcion || '');
  const [hashtags, setHashtags] = useState('');
  const [loadingTr, setLoadingTr] = useState(!item.transcripcion);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeErr, setTranscribeErr] = useState('');

  // Variantes A/B (solo YouTube): portadas/títulos distintos que YouTube sirve para el mismo video.
  const [variantes, setVariantes] = useState<any[]>([]);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [searchingVar, setSearchingVar] = useState(false);
  const [varMsg, setVarMsg] = useState('');

  // Traducción a español de la transcripción (manual, modelo barato de OpenRouter).
  const [traduccion, setTraduccion] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translateErr, setTranslateErr] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingTr(true);
    setVariantes([]);
    setVideoId(null);
    setVarMsg('');
    setTraduccion('');
    setShowTranslation(false);
    setTranslateErr('');
    fetch(`/api/item?platform=${item.platform}&id=${item.id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive || d.error) return;
        if (d.transcripcion) setTranscripcion(d.transcripcion);
        if (d.hashtags) setHashtags(d.hashtags);
        if (Array.isArray(d.variantes)) setVariantes(d.variantes);
        if (d.videoId) setVideoId(d.videoId);
        if (d.traduccion) {
          setTraduccion(d.traduccion);
          setShowTranslation(true); // si ya hay traducción, mostrarla por defecto
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoadingTr(false));
    return () => {
      alive = false;
    };
  }, [item.id, item.platform]);

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

  async function transcribe() {
    setTranscribing(true);
    setTranscribeErr('');
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, platform: 'yt', url: item.url }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Falló la transcripción');
      setTranscripcion(data.text);
      onUploaded();
    } catch (err: any) {
      setTranscribeErr(err.message);
    } finally {
      setTranscribing(false);
    }
  }

  async function translate() {
    setTranslating(true);
    setTranslateErr('');
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, platform: item.platform, text: transcripcion }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Falló la traducción');
      setTraduccion(data.text);
      setShowTranslation(true);
    } catch (err: any) {
      setTranslateErr(err.message);
    } finally {
      setTranslating(false);
    }
  }

  async function buscarVariantes() {
    if (!videoId) return;
    setSearchingVar(true);
    setVarMsg('');
    try {
      const res = await fetch('/api/scrape-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Error');
      if (Array.isArray(data.variantes)) setVariantes(data.variantes);
      setVarMsg(data.message || (data.added ? '¡Nueva variante!' : 'No encontré nuevas'));
    } catch (err: any) {
      setVarMsg('Error: ' + err.message);
    } finally {
      setSearchingVar(false);
    }
  }

  const metaRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="bg-white w-full max-w-5xl rounded-2xl overflow-hidden my-6" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{item.creador ? `@${item.creador}` : '—'}</span>
            <span className="text-xs text-muted shrink-0">{item.platform === 'ig' ? 'Instagram' : 'YouTube'}</span>
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

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 border-b border-line">
          {([['detalle', 'Video y transcripción'], ['miversion', 'Mi versión']] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 h-9 text-sm rounded-t-md -mb-px border-b-2 ${
                tab === k ? 'border-accent text-accent font-medium' : 'border-transparent text-muted hover:text-gray-700'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {tab === 'detalle' ? (
          <div className="grid md:grid-cols-[260px_1fr]">
            {/* IZQUIERDA: datos del video */}
            <div className="p-4 border-r border-line bg-gray-50">
              <div
                className={`relative w-full ${item.platform === 'ig' ? 'pt-[133%]' : 'pt-[56%]'} bg-gray-200 rounded-lg overflow-hidden mb-3`}
              >
                {item.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {item.thumbnail && (
                  <a href={item.thumbnail} download className="text-center text-xs h-8 leading-8 rounded-md border border-line bg-white hover:bg-gray-100">
                    Thumbnail
                  </a>
                )}
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-center text-xs h-8 leading-8 rounded-md border border-line bg-white hover:bg-gray-100">
                    Ver original ↗
                  </a>
                )}
              </div>

              <div className="divide-y divide-line border-y border-line">
                {metaRow('Vistas', fmtNum(item.views))}
                {item.likes != null && metaRow('Likes', fmtNum(item.likes))}
                {item.comentarios != null && metaRow('Comentarios', fmtNum(item.comentarios))}
                {item.duracion && metaRow('Duración', item.duracion)}
                {metaRow('Publicado', fmtDateShort(item.fechaPublicacion))}
                {metaRow('Scrapeado', fmtDateShort(item.scrapeadoEn))}
                {item.proyecto && metaRow('Proyecto', item.proyecto)}
              </div>

              {hashtags && (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Hashtags</div>
                  <div className="text-xs text-accent break-words">{hashtags}</div>
                </div>
              )}

              {item.platform === 'yt' && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">
                    Variantes A/B ({variantes.length}/3)
                  </div>
                  {variantes.length > 0 && (
                    <div className="space-y-2 mb-2">
                      {variantes.map((v, i) => (
                        <div key={i} className="rounded-md border border-line bg-white overflow-hidden">
                          {v.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.thumbnail} alt="" className="w-full aspect-video object-cover" />
                          )}
                          <div className="px-2 py-1.5 text-[11px] leading-snug text-gray-700">{v.titulo || '—'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={buscarVariantes}
                    disabled={searchingVar || variantes.length >= 3 || !videoId}
                    className="w-full h-9 text-xs rounded-md bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {searchingVar
                      ? 'Buscando…'
                      : variantes.length >= 3
                      ? 'Máximo de 3 alcanzado'
                      : '🔄 Buscar nuevas portadas/títulos'}
                  </button>
                  {varMsg && <p className="text-[11px] text-muted mt-1.5">{varMsg}</p>}
                  <p className="text-[10px] text-muted mt-1 leading-snug">
                    Re-busca en el feed del canal con sesión nueva (como incógnito). Dale varias veces: a
                    veces cae una variante, a veces no.
                  </p>
                </div>
              )}
            </div>

            {/* DERECHA: transcripción grande */}
            <div className="p-5 flex flex-col min-h-[58vh]">
              {item.titulo && (
                <div className="mb-4">
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Descripción</div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap max-h-40 overflow-y-auto">{item.titulo}</p>
                </div>
              )}

              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[13px] font-medium shrink-0">
                  {item.platform === 'ig' ? 'Transcripción' : 'Transcripción / Subtítulos'}
                </span>
                <div className="flex items-center gap-3">
                  {transcripcion && !transcribing && (
                    traduccion ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <button
                          onClick={() => setShowTranslation(false)}
                          className={!showTranslation ? 'text-accent font-medium' : 'text-muted hover:text-gray-700'}
                        >
                          Original
                        </button>
                        <span className="text-line">·</span>
                        <button
                          onClick={() => setShowTranslation(true)}
                          className={showTranslation ? 'text-accent font-medium' : 'text-muted hover:text-gray-700'}
                        >
                          Español
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={translate}
                        disabled={translating}
                        className="text-xs text-muted hover:text-accent disabled:opacity-50"
                      >
                        {translating ? 'Traduciendo…' : '🌐 Traducir a español'}
                      </button>
                    )
                  )}
                  {item.platform === 'yt' && transcripcion && !transcribing && (
                    <button onClick={transcribe} className="text-xs text-muted hover:text-accent">
                      ↻ Re-transcribir
                    </button>
                  )}
                  {transcripcion && !transcribing && (
                    <button
                      onClick={() => setExpanded((e) => !e)}
                      className="text-xs text-muted hover:text-accent"
                      title={expanded ? 'Colapsar' : 'Expandir para leer completa'}
                    >
                      {expanded ? '⤡ Colapsar' : '⤢ Expandir'}
                    </button>
                  )}
                </div>
              </div>

              <div
                className={`flex-1 rounded-lg border border-line bg-gray-50 p-4 overflow-y-auto ${
                  expanded ? 'fixed inset-4 z-[60] bg-white shadow-2xl max-h-none' : 'max-h-[52vh]'
                }`}
              >
                {expanded && (
                  <button
                    onClick={() => setExpanded(false)}
                    className="fixed top-6 right-6 z-[61] h-9 w-9 rounded-full bg-white border border-line shadow flex items-center justify-center text-gray-600 hover:text-gray-900"
                    aria-label="Cerrar vista expandida"
                  >
                    ✕
                  </button>
                )}
                {transcribing ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-muted py-10">
                    <div className="text-2xl mb-2 animate-pulse">✨</div>
                    <div className="text-sm font-medium text-gray-700">Transcribiendo con IA…</div>
                    <div className="text-xs mt-1">Bajando el audio y transcribiendo. Tarda ~1–2 min. No cierres la ventana.</div>
                  </div>
                ) : transcripcion ? (
                  <div className="space-y-3">
                    {toParagraphs(showTranslation && traduccion ? traduccion : transcripcion).map((p, i) => (
                      <p key={i} className="text-[13px] leading-relaxed text-gray-800">{p}</p>
                    ))}
                  </div>
                ) : loadingTr ? (
                  <div className="text-sm text-muted text-center py-10">Cargando…</div>
                ) : item.platform === 'yt' ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-10">
                    <p className="text-sm text-muted mb-4 max-w-xs">
                      Este video aún no tiene transcripción. Genérala con IA (baja el audio y lo transcribe).
                    </p>
                    <button
                      onClick={transcribe}
                      className="h-11 px-6 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 inline-flex items-center gap-2"
                    >
                      <span className="text-base">✨</span> Transcribir con IA
                    </button>
                    <p className="text-[11px] text-muted mt-2">~1–2 min · usa gpt-4o-mini-transcribe</p>
                  </div>
                ) : (
                  <div className="text-sm text-muted text-center py-10">Sin transcripción.</div>
                )}
                {transcribeErr && <p className="text-xs text-red-600 mt-3">{transcribeErr}</p>}
                {translateErr && <p className="text-xs text-red-600 mt-3">Traducción: {translateErr}</p>}
              </div>
            </div>
          </div>
        ) : (
          /* MI VERSIÓN */
          <div className="p-5">
            <label className="text-xs text-muted block mb-1">Guión</label>
            <textarea
              value={guion}
              onChange={(e) => setGuion(e.target.value)}
              placeholder="Escribe o pega aquí tu adaptación del guión…"
              className="w-full min-h-[140px] text-sm border border-line rounded-md p-2 mb-3 outline-none focus:border-accent resize-y"
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
        )}
      </div>
    </div>
  );
}
