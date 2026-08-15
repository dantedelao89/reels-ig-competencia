'use client';

// Selector de una opción con buscador difuso. Sustituye a los <select> largos: con 30 cuentas,
// desplegar y buscar a ojo es peor que escribir 3 letras.
//
// El emparejamiento ignora acentos y separadores (., _, -), así que "nxtai" encuentra "nxxt.ai"
// y "paula" encuentra "paulaaperich_". Puntúa para que lo más obvio quede arriba: coincidencia
// exacta > empieza por > empieza una palabra > contiene > subsecuencia.

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchOption {
  value: string;
  label: string;
  hint?: string;
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Devuelve la puntuación (mayor = mejor) o -1 si no hay coincidencia.
function puntuar(texto: string, consulta: string): number {
  const t = norm(texto);
  const q = norm(consulta);
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - t.length;

  // Inicio de "palabra" según los separadores del texto original.
  const partes = texto.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  if (partes.some((p) => norm(p).startsWith(q))) return 800 - t.length;

  const i = t.indexOf(q);
  if (i >= 0) return 700 - i;

  // Subsecuencia: todas las letras en orden, aunque no seguidas. Penaliza los huecos.
  let ti = 0;
  let huecos = 0;
  for (const ch of q) {
    const encontrado = t.indexOf(ch, ti);
    if (encontrado < 0) return -1;
    huecos += encontrado - ti;
    ti = encontrado + 1;
  }
  return 500 - huecos;
}

export default function SearchSelect({
  value,
  options,
  onChange,
  placeholder = 'Buscar…',
  emptyLabel = 'Todas',
  className = '',
}: {
  value: string;
  options: SearchOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const todas: SearchOption[] = useMemo(
    () => [{ value: '', label: emptyLabel }, ...options],
    [options, emptyLabel]
  );

  const filtradas = useMemo(() => {
    if (!q.trim()) return todas;
    return todas
      .map((o) => ({ o, p: Math.max(puntuar(o.label, q), puntuar(o.value, q)) }))
      .filter((x) => x.p >= 0)
      .sort((a, b) => b.p - a.p || a.o.label.localeCompare(b.o.label))
      .map((x) => x.o);
  }, [todas, q]);

  useEffect(() => setCursor(0), [q]);

  // Mantiene la opción marcada dentro de la vista al navegar con el teclado.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const actual = todas.find((o) => o.value === value);

  function elegir(v: string) {
    onChange(v);
    setOpen(false);
    setQ('');
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-9 min-w-[190px] px-3 rounded-lg border border-line bg-white text-sm inline-flex items-center gap-2 hover:border-gray-300"
      >
        <span className={`flex-1 text-left truncate ${value ? '' : 'text-muted'}`}>
          {actual?.label || emptyLabel}
        </span>
        <span className="text-[10px] text-muted">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-72 bg-white border border-line rounded-xl shadow-lg overflow-hidden">
            <div className="p-2 border-b border-line">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtradas.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
                  else if (e.key === 'Enter') { e.preventDefault(); if (filtradas[cursor]) elegir(filtradas[cursor].value); }
                  else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); }
                }}
                placeholder={placeholder}
                className="w-full h-8 px-2 text-sm border border-line rounded-md outline-none focus:border-accent"
              />
            </div>
            <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
              {filtradas.length === 0 && <div className="px-3 py-3 text-xs text-muted">Sin coincidencias.</div>}
              {filtradas.map((o, i) => (
                <button
                  key={o.value || '__todas'}
                  data-i={i}
                  onClick={() => elegir(o.value)}
                  onMouseEnter={() => setCursor(i)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                    i === cursor ? 'bg-accent-soft' : ''
                  } ${o.value === value ? 'font-medium' : ''}`}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-[11px] text-muted tabular-nums shrink-0">{o.hint}</span>}
                  {o.value === value && <span className="text-accent text-xs shrink-0">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
