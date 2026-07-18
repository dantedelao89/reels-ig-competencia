'use client';

// Sistema de toasts: notificaciones no bloqueantes que se apilan, tienen auto-dismiss configurable
// y se pueden cerrar a mano. Provider en el layout + hook useToast() para dispararlos desde cualquier
// componente cliente.

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastAPI {
  toast: (message: string, opts?: { kind?: ToastKind; duration?: number }) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}

const STYLES: Record<ToastKind, string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-line bg-white text-gray-800',
};
const ICONS: Record<ToastKind, string> = { success: '✓', error: '⚠️', info: 'ℹ️' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback<ToastAPI['toast']>((message, opts = {}) => {
    const id = nextId.current++;
    const kind = opts.kind || 'info';
    // error por defecto dura más (6s); éxito/info 3.5s. duration=0 → no auto-dismiss.
    const duration = opts.duration ?? (kind === 'error' ? 6000 : 3500);
    setToasts((t) => [...t, { id, kind, message }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api: ToastAPI = {
    toast,
    success: (m, d) => toast(m, { kind: 'success', duration: d }),
    error: (m, d) => toast(m, { kind: 'error', duration: d }),
    info: (m, d) => toast(m, { kind: 'info', duration: d }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,360px)]" role="region" aria-label="Notificaciones">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex items-start gap-2 px-3.5 py-2.5 rounded-lg border shadow-sm text-sm animate-toast-in ${STYLES[t.kind]}`}
          >
            <span className="shrink-0 leading-5" aria-hidden="true">{ICONS[t.kind]}</span>
            <span className="flex-1 break-words leading-5">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-50 hover:opacity-100 leading-5" aria-label="Cerrar">✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
