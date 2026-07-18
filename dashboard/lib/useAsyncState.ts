'use client';

// Hook reutilizable para LECTURAS async (fetch de datos). Devuelve { status, data, error } con
// status como union type, más run() (refetch manual) y reset(). Ignora respuestas obsoletas
// (si se dispara otra petición antes de que termine la anterior, gana la última).

import { useCallback, useEffect, useRef, useState, DependencyList } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
  run: () => Promise<void>;
  reset: () => void;
}

export function useAsyncState<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList = [],
  opts: { auto?: boolean } = {}
): AsyncState<T> {
  const auto = opts.auto !== false;
  const [status, setStatus] = useState<AsyncStatus>(auto ? 'loading' : 'idle');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const reqId = useRef(0);

  const run = useCallback(async () => {
    const id = ++reqId.current;
    setStatus('loading');
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (id !== reqId.current) return; // llegó una respuesta más nueva → descarta esta
      setData(result);
      setStatus('success');
    } catch (e: any) {
      if (id !== reqId.current) return;
      setError(e?.message || 'Error inesperado');
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    reqId.current++;
    setStatus('idle');
    setData(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (auto) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { status, data, error, run, reset };
}
