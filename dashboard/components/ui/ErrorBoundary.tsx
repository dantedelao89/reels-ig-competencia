'use client';

// Error Boundary global: captura errores inesperados de renderizado en el árbol de React y muestra
// una UI de fallback amigable en vez de una pantalla en blanco. (Los errores async de fetch se
// manejan con ErrorState; esto es la última red de seguridad para bugs de render.)

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Error inesperado' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 bg-[#f6f7f9]">
        <div className="text-4xl mb-3" aria-hidden="true">🛠️</div>
        <div className="text-lg font-semibold text-gray-800">Algo se rompió en la pantalla</div>
        <div className="text-sm text-muted mt-1 max-w-sm break-words">
          Ocurrió un error inesperado. Recargar suele arreglarlo.
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 h-10 px-5 text-sm rounded-lg bg-accent text-white font-medium hover:opacity-90"
        >
          Recargar
        </button>
      </div>
    );
  }
}
