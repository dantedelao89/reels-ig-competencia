// Estado de error de carga: mensaje accionable (no un código crudo) + botón Reintentar cuando el
// error es recuperable. Se distingue visualmente del EmptyState (esto es un fallo, no "no hay datos").

interface Props {
  message?: string;
  onRetry?: () => void; // si se pasa → error recuperable (muestra Reintentar)
  className?: string;
}

// Traduce mensajes técnicos comunes a algo entendible. Deja pasar el resto.
function friendly(msg?: string): string {
  const m = (msg || '').toLowerCase();
  if (!msg) return 'Algo salió mal al cargar.';
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
  }
  if (m.includes('timeout') || m.includes('timed out')) return 'La operación tardó demasiado. Intenta de nuevo.';
  if (m.includes('401') || m.includes('no autorizado')) return 'Tu sesión expiró. Recarga la página.';
  if (m.includes('500') || m.includes('502') || m.includes('503')) return 'El servidor tuvo un problema. Intenta de nuevo en un momento.';
  return msg;
}

export default function ErrorState({ message, onRetry, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-4 ${className}`}>
      <div className="text-3xl mb-3" aria-hidden="true">⚠️</div>
      <div className="text-sm font-medium text-gray-700">No se pudo cargar</div>
      <div className="text-xs text-muted mt-1 max-w-xs break-words">{friendly(message)}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 h-9 px-4 text-sm rounded-lg border border-line bg-white font-medium hover:bg-gray-50"
        >
          ↻ Reintentar
        </button>
      )}
    </div>
  );
}
