'use client';

// La única decisión que Dante toma en todo el flujo: qué titular de portada. Las tarjetas son
// grandes y de texto puro porque el titular hay que leerlo como se leerá en la portada.

import { useState } from 'react';
import type { RegenGancho, RegenMeta } from '@/lib/types';
import AsyncButton from '../ui/AsyncButton';

// Mismas reglas que valida el servidor, para avisar en vivo mientras escribe el suyo.
function fallosDelTitular(titular: string, piezas: number | null): string[] {
  const t = titular.trim();
  if (!t) return [];
  const lineas = t.split('\n');
  const fallos: string[] = [];
  if (lineas.length > 3) fallos.push(`${lineas.length} líneas (máximo 3)`);
  const largas = lineas.filter((l) => l.length > 16);
  if (largas.length) fallos.push(`${largas.length} línea(s) pasan de 16 caracteres`);
  const palabras = t.split(/\s+/).filter(Boolean).length;
  if (palabras > 8) fallos.push(`${palabras} palabras (máximo 8)`);
  const nums = (t.match(/\d+/g) || []).map(Number).filter((n) => n !== piezas);
  if (nums.length) fallos.push(piezas ? `el carrusel entrega ${piezas}, no ${nums.join('/')}` : 'no sabemos cuántas piezas entrega: quita el número');
  return fallos;
}

export default function GanchoSelector({
  meta,
  numLaminas,
  costoEstimado,
  onElegir,
  onOtros,
  eligiendo,
  pidiendoOtros,
}: {
  meta: RegenMeta;
  numLaminas: number;
  costoEstimado: number;
  onElegir: (g: { ganchoId?: string; titular?: string }) => void;
  onOtros: () => void;
  eligiendo: string | null;
  pidiendoOtros: boolean;
}) {
  const [verAnalisis, setVerAnalisis] = useState(false);
  const [escribiendo, setEscribiendo] = useState(false);
  const [mio, setMio] = useState('');
  const a = meta.analisis;
  const fallosMio = fallosDelTitular(mio, a.piezas);
  const regala = (a.queEntrega || '').toLowerCase();
  const palabraClave = regala.includes('prompt') ? 'PROMPT' : null;
  const nombraLoQueRegala = !palabraClave || mio.toUpperCase().includes(palabraClave);

  return (
    <div className="p-4 max-w-3xl mx-auto">
      {/* Contexto: qué entendió la IA */}
      <div className="text-xs text-muted mb-4">
        <span className="text-gray-700">
          {a.queEntrega ? <><b>Entrega:</b> {a.queEntrega}{a.piezas ? ` (${a.piezas})` : ''}</> : 'Sin entrega detectada'}
        </span>
        {a.keyword && <> · <b>Keyword:</b> {a.keyword}</>}
        {' · '}
        <button onClick={() => setVerAnalisis((v) => !v)} className="underline underline-offset-2 hover:text-accent">
          {verAnalisis ? 'ocultar análisis' : 'ver análisis'}
        </button>
      </div>
      {verAnalisis && (
        <div className="text-xs text-gray-600 space-y-1 mb-4 p-3 rounded-lg border border-line bg-gray-50">
          {a.tema && <div><b>Tema:</b> {a.tema}</div>}
          {a.dolor && <div><b>Dolor:</b> {a.dolor}</div>}
          {a.argumento && <div><b>Argumento:</b> {a.argumento}</div>}
          {a.publico && <div><b>Público:</b> {a.publico}</div>}
        </div>
      )}

      <h3 className="text-sm font-medium mb-1">Elige el titular de la portada</h3>
      <p className="text-xs text-muted mb-4">
        Es la única decisión que tienes que tomar: la portada se lleva el 80% del resultado. Con
        el que elijas, la IA escribe las {numLaminas} láminas y las genera.
      </p>

      <div className="space-y-3">
        {meta.ganchos.map((g: RegenGancho) => (
          <div key={g.id} className="rounded-xl border border-line bg-white p-4 hover:border-accent transition-colors">
            <div className="text-[10px] uppercase tracking-[0.15em] text-accent font-medium mb-2">{g.formula}</div>
            <div className="text-[26px] leading-[1.1] font-extrabold tracking-tight whitespace-pre-line mb-2">
              {g.titular}
            </div>
            <div className="flex items-end justify-between gap-3">
              <div className="text-[11px] text-muted flex-1">
                {g.porque}
                {g.avisos?.length ? <div className="text-amber-600 mt-1">⚠️ {g.avisos.join(' · ')}</div> : null}
              </div>
              <AsyncButton
                onClick={() => onElegir({ ganchoId: g.id })}
                loading={eligiendo === g.id}
                loadingLabel="Arrancando…"
                disabled={!!eligiendo}
                className="shrink-0"
              >
                Elegir y hacer todo
              </AsyncButton>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-4 text-xs">
        <button
          onClick={onOtros}
          disabled={pidiendoOtros || !!eligiendo}
          className="text-muted hover:text-accent underline underline-offset-2 disabled:opacity-50"
        >
          {pidiendoOtros ? 'Pensando…' : '↻ Otros 5 titulares'}
        </button>
        <button
          onClick={() => setEscribiendo((v) => !v)}
          className="text-muted hover:text-accent underline underline-offset-2"
        >
          ✍️ Escribo el mío
        </button>
        <span className="flex-1" />
        <span className="text-muted">Generar cuesta ~${costoEstimado} USD</span>
      </div>

      {escribiendo && (
        <div className="mt-3 p-3 rounded-xl border border-line bg-gray-50">
          <textarea
            value={mio}
            onChange={(e) => setMio(e.target.value)}
            rows={3}
            placeholder={'TU FOTO DE IA\nSE NOTA A METROS.\n6 PROMPTS.'}
            className="w-full text-lg font-extrabold uppercase tracking-tight border border-line rounded-lg p-2 outline-none focus:border-accent resize-none bg-white"
          />
          <div className="flex items-center gap-3 mt-2 text-[11px]">
            <span className="text-muted">
              {mio.split('\n').map((l, i) => (
                <span key={i} className={l.length > 16 ? 'text-red-600 font-medium' : ''}>
                  {i > 0 && ' · '}
                  {l.length}
                </span>
              ))}
            </span>
            {fallosMio.length > 0 && <span className="text-red-600">{fallosMio.join(' · ')}</span>}
            {mio.trim() && !nombraLoQueRegala && (
              <span className="text-amber-600">Ojo: la regla pide que el titular nombre {palabraClave?.toLowerCase()}s</span>
            )}
            <span className="flex-1" />
            <AsyncButton
              onClick={() => onElegir({ titular: mio.trim() })}
              loading={eligiendo === 'manual'}
              loadingLabel="Arrancando…"
              disabled={!mio.trim() || !!eligiendo}
            >
              Usar el mío
            </AsyncButton>
          </div>
        </div>
      )}
    </div>
  );
}
