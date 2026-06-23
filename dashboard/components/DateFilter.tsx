'use client';

import { useState } from 'react';

export interface DateState {
  dateField: 'fecha_publicacion' | 'scrapeado_en';
  desde: string;
  hasta: string;
}

interface Props {
  value: DateState;
  onChange: (v: DateState) => void;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOf(date: string) {
  return `${date}T00:00:00`;
}
function endOf(date: string) {
  return `${date}T23:59:59`;
}

export default function DateFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const active = !!(value.desde || value.hasta);
  const fieldLabel = value.dateField === 'scrapeado_en' ? 'Scrapeado' : 'Publicación';

  function setField(f: DateState['dateField']) {
    onChange({ ...value, dateField: f });
  }
  function applyRange(fromDate: Date, toDate: Date) {
    onChange({ ...value, desde: startOf(ymd(fromDate)), hasta: endOf(ymd(toDate)) });
  }
  function preset(kind: string) {
    const now = new Date();
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kind === 'hoy') applyRange(t, t);
    else if (kind === 'ayer') {
      const y = new Date(t);
      y.setDate(y.getDate() - 1);
      applyRange(y, y);
    } else if (kind === '7') {
      const f = new Date(t);
      f.setDate(f.getDate() - 6);
      applyRange(f, t);
    } else if (kind === '30') {
      const f = new Date(t);
      f.setDate(f.getDate() - 29);
      applyRange(f, t);
    } else if (kind === 'mes') {
      applyRange(new Date(t.getFullYear(), t.getMonth(), 1), t);
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-8 px-3 text-xs rounded-md border inline-flex items-center gap-1.5 ${
          active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-gray-700'
        }`}
      >
        Fecha {active && <span className="font-medium">· {fieldLabel}</span>}
        <span className="text-[10px]">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 w-72 bg-white border border-line rounded-xl shadow-lg overflow-hidden">
            <div className="p-2 border-b border-line">
              <div className="flex bg-gray-100 rounded-md p-0.5 text-xs">
                <button
                  onClick={() => setField('fecha_publicacion')}
                  className={`flex-1 py-1.5 rounded ${value.dateField === 'fecha_publicacion' ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}
                >
                  Publicación
                </button>
                <button
                  onClick={() => setField('scrapeado_en')}
                  className={`flex-1 py-1.5 rounded ${value.dateField === 'scrapeado_en' ? 'bg-white font-medium shadow-sm' : 'text-muted'}`}
                >
                  Scrapeado
                </button>
              </div>
            </div>

            <div className="p-2 grid grid-cols-2 gap-1.5 border-b border-line text-xs">
              <button onClick={() => preset('hoy')} className="py-1.5 rounded-md border border-line hover:bg-gray-50">Hoy</button>
              <button onClick={() => preset('ayer')} className="py-1.5 rounded-md border border-line hover:bg-gray-50">Ayer</button>
              <button onClick={() => preset('7')} className="py-1.5 rounded-md border border-line hover:bg-gray-50">Últimos 7 días</button>
              <button onClick={() => preset('30')} className="py-1.5 rounded-md border border-line hover:bg-gray-50">Últimos 30 días</button>
              <button onClick={() => preset('mes')} className="py-1.5 rounded-md border border-line hover:bg-gray-50 col-span-2">Este mes</button>
            </div>

            <div className="p-2 text-xs">
              <div className="text-muted mb-1.5">Rango personalizado</div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={value.desde ? value.desde.slice(0, 10) : ''}
                  onChange={(e) => onChange({ ...value, desde: e.target.value ? startOf(e.target.value) : '' })}
                  className="flex-1 h-8 px-2 border border-line rounded-md"
                />
                <span className="text-muted">→</span>
                <input
                  type="date"
                  value={value.hasta ? value.hasta.slice(0, 10) : ''}
                  onChange={(e) => onChange({ ...value, hasta: e.target.value ? endOf(e.target.value) : '' })}
                  className="flex-1 h-8 px-2 border border-line rounded-md"
                />
              </div>
            </div>

            {active && (
              <div className="p-2 border-t border-line flex justify-end">
                <button
                  onClick={() => onChange({ ...value, desde: '', hasta: '' })}
                  className="text-xs text-muted hover:text-gray-700 px-2 h-7"
                >
                  Limpiar fechas
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
