'use client';

// Gestor de la biblioteca de referencias del Regenerador de carruseles: imágenes ancla del
// branding cuaderno + fotos de CTA, etiquetadas por tipo de slide. Modal simple sobre
// /api/regen/refs (GET/POST multipart/DELETE soft-delete).

import { useEffect, useRef, useState } from 'react';
import { useToast } from './ui/Toast';
import AsyncButton from './ui/AsyncButton';
import Spinner from './ui/Spinner';

export interface RegenRef {
  id: string;
  tipo: string;
  nombre: string;
  url: string;
  notas: string | null;
  activo: boolean;
  creado_en: string;
}

export const REF_TIPOS = [
  { key: 'portada', label: 'Portada' },
  { key: 'lista', label: 'Lista' },
  { key: 'quote', label: 'Quote' },
  { key: 'numero', label: 'Número' },
  { key: 'contenido', label: 'Contenido' },
  { key: 'cta', label: 'CTA (tu cara)' },
];

const TIPO_LABEL: Record<string, string> = Object.fromEntries(REF_TIPOS.map((t) => [t.key, t.label]));

export default function RefsManager({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [refs, setRefs] = useState<RegenRef[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form de subida
  const [file, setFile] = useState<File | null>(null);
  const [tipo, setTipo] = useState('portada');
  const [nombre, setNombre] = useState('');
  const [notas, setNotas] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function load(all: boolean) {
    try {
      const res = await fetch(`/api/regen/refs${all ? '?all=1' : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRefs(data.refs);
    } catch (e: any) {
      toast.error(e.message || 'No se pudieron cargar las referencias');
      setRefs([]);
    }
  }

  useEffect(() => {
    load(showInactive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  async function upload() {
    if (!file || !nombre.trim() || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('tipo', tipo);
      form.append('nombre', nombre.trim());
      if (notas.trim()) form.append('notas', notas.trim());
      const res = await fetch('/api/regen/refs', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Error al subir');
      toast.success('Referencia añadida');
      setFile(null);
      setNombre('');
      setNotas('');
      if (fileInput.current) fileInput.current.value = '';
      load(showInactive);
    } catch (e: any) {
      toast.error(e.message || 'No se pudo subir');
    } finally {
      setUploading(false);
    }
  }

  async function setActivo(ref: RegenRef, activo: boolean) {
    try {
      const res = await fetch('/api/regen/refs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ref.id, activo }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Error');
      setRefs((prev) => prev && prev.map((r) => (r.id === ref.id ? { ...r, activo } : r)).filter((r) => showInactive || r.activo));
    } catch (e: any) {
      toast.error(e.message || 'No se pudo actualizar');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <div className="font-semibold">🎨 Referencias del regenerador</div>
            <div className="text-xs text-muted">
              Anclas de estilo (branding cuaderno) y fotos de CTA. La IA elige una por slide al regenerar.
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-gray-100 text-muted" aria-label="Cerrar">✕</button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {/* Subida */}
          <div className="flex flex-wrap items-end gap-2 p-3 rounded-xl border border-line bg-gray-50 mb-5">
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              Imagen
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="text-xs w-48"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              Tipo
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-9 px-2 rounded-lg border border-line bg-white text-sm">
                {REF_TIPOS.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              Nombre
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ancla portada" className="h-9 px-2 rounded-lg border border-line bg-white text-sm w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600 flex-1 min-w-[140px]">
              Notas (opcional)
              <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Cuándo usarla" className="h-9 px-2 rounded-lg border border-line bg-white text-sm w-full" />
            </label>
            <AsyncButton onClick={upload} disabled={!file || !nombre.trim()} loading={uploading} loadingLabel="Subiendo…">
              Añadir
            </AsyncButton>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted mb-3 select-none">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Mostrar desactivadas
          </label>

          {/* Grid */}
          {refs === null ? (
            <div className="flex justify-center py-10"><Spinner size={22} /></div>
          ) : refs.length === 0 ? (
            <div className="text-sm text-muted text-center py-10">
              Sin referencias todavía. Sube las anclas de tu branding y tus fotos de CTA.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {refs.map((r) => (
                <div key={r.id} className={`rounded-xl border border-line overflow-hidden bg-white ${r.activo ? '' : 'opacity-50'}`}>
                  <div className="relative w-full pt-[125%] bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt={r.nombre} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] uppercase tracking-wide">
                      {TIPO_LABEL[r.tipo] || r.tipo}
                    </span>
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-medium truncate" title={r.nombre}>{r.nombre}</div>
                    {r.notas && <div className="text-[11px] text-muted truncate" title={r.notas}>{r.notas}</div>}
                    <button
                      onClick={() => setActivo(r, !r.activo)}
                      className="mt-1.5 text-[11px] text-muted hover:text-gray-700 underline underline-offset-2"
                    >
                      {r.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
