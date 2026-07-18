'use client';

// Indicador GLOBAL de procesos en curso: un chip flotante, persistente y NO bloqueante (no tapa la
// pantalla) que muestra qué se está trabajando (scrapes, transcripciones, traducciones…), aunque el
// usuario navegue a otra vista. Cada acción larga registra una tarea con begin(label) y la quita al
// terminar con la función que devuelve.

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import Spinner from './Spinner';

interface Task {
  id: number;
  label: string;
}
interface ActivityAPI {
  // Registra una tarea en curso; devuelve una función para marcarla como terminada.
  begin: (label: string) => () => void;
}

const ActivityContext = createContext<ActivityAPI | null>(null);

export function useActivity(): ActivityAPI {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error('useActivity debe usarse dentro de <ActivityProvider>');
  return ctx;
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);
  const nextId = useRef(1);

  const begin = useCallback((label: string) => {
    const id = nextId.current++;
    setTasks((t) => [...t, { id, label }]);
    return () => setTasks((t) => t.filter((x) => x.id !== id));
  }, []);

  return (
    <ActivityContext.Provider value={{ begin }}>
      {children}
      {tasks.length > 0 && (
        <div className="fixed bottom-4 left-4 z-[90] w-[min(90vw,320px)]">
          {/* Lista expandible de tareas (se abre al pasar el mouse o al hacer clic en el chip). */}
          {open && (
            <div className="mb-2 bg-white border border-line rounded-lg shadow-lg p-2 space-y-1.5 max-h-64 overflow-y-auto">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs text-gray-700">
                  <Spinner size={12} className="text-accent shrink-0" />
                  <span className="truncate">{t.label}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-full bg-ink text-white text-xs font-medium shadow-lg hover:opacity-95"
            title="Procesos en curso"
          >
            <Spinner size={14} />
            {tasks.length === 1 ? '1 proceso en curso' : `${tasks.length} procesos en curso`}
            <span className="text-[10px] opacity-70">{open ? '▾' : '▴'}</span>
          </button>
        </div>
      )}
    </ActivityContext.Provider>
  );
}
