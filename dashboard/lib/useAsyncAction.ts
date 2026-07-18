'use client';

// Hook reutilizable para ACCIONES async (submit, scrape, borrar, subir…). Envuelve la función,
// expone { status, error, run } y evita ejecuciones concurrentes (anti doble-click). Opcionalmente
// dispara toasts de éxito/error automáticamente.

import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { AsyncStatus } from './useAsyncState';

interface Options<TArgs extends any[], TResult> {
  onSuccess?: (result: TResult, ...args: TArgs) => void;
  onError?: (error: Error, ...args: TArgs) => void;
  successToast?: string | ((result: TResult) => string);
  errorToast?: boolean; // si true, muestra el error como toast (default true)
}

export interface AsyncAction<TArgs extends any[], TResult> {
  status: AsyncStatus;
  error: string | null;
  loading: boolean;
  run: (...args: TArgs) => Promise<TResult | undefined>;
}

export function useAsyncAction<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  opts: Options<TArgs, TResult> = {}
): AsyncAction<TArgs, TResult> {
  const { onSuccess, onError, successToast, errorToast = true } = opts;
  const toast = useToast();
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (...args: TArgs) => {
      if (running.current) return; // ya hay una ejecución en curso → ignora (anti doble-click)
      running.current = true;
      setStatus('loading');
      setError(null);
      try {
        const result = await fn(...args);
        setStatus('success');
        if (successToast) toast.success(typeof successToast === 'function' ? successToast(result) : successToast);
        onSuccess?.(result, ...args);
        return result;
      } catch (e: any) {
        const msg = e?.message || 'Error inesperado';
        setError(msg);
        setStatus('error');
        if (errorToast) toast.error(msg);
        onError?.(e instanceof Error ? e : new Error(msg), ...args);
        return undefined;
      } finally {
        running.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn]
  );

  return { status, error, loading: status === 'loading', run };
}
