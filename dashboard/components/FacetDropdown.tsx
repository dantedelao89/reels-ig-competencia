'use client';

import { useState } from 'react';

interface Option {
  value: string;
  count: number;
}

interface Props {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
}

export default function FacetDropdown({ label, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = q
    ? options.filter((o) => o.value.toLowerCase().includes(q.toLowerCase()))
    : options;

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  }

  const active = selected.length > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-8 px-3 text-xs rounded-md border inline-flex items-center gap-1.5 ${
          active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-gray-700'
        }`}
      >
        {label}
        {active && <span className="font-medium">· {selected.length}</span>}
        <span className="text-[10px]">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-64 bg-white border border-line rounded-xl shadow-lg overflow-hidden">
            <div className="p-2 border-b border-line">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Buscar ${label.toLowerCase()}…`}
                className="w-full h-8 px-2 text-xs border border-line rounded-md outline-none focus:border-accent"
              />
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted">Sin opciones.</div>
              )}
              {filtered.map((o) => {
                const sel = selected.includes(o.value);
                return (
                  <label
                    key={o.value}
                    className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer hover:bg-gray-50"
                  >
                    <input type="checkbox" checked={sel} onChange={() => toggle(o.value)} />
                    <span className="flex-1 truncate">{o.value}</span>
                    <span className="text-xs text-muted tabular-nums">{o.count}</span>
                  </label>
                );
              })}
            </div>
            {active && (
              <div className="p-2 border-t border-line flex justify-end">
                <button
                  onClick={() => onChange([])}
                  className="text-xs text-muted hover:text-gray-700 px-2 h-7"
                >
                  Limpiar
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
