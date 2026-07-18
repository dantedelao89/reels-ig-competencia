// Skeletons: placeholders con la MISMA forma/dimensiones que el contenido real, para evitar
// layout shift. Pulse sutil. Respetan los tokens (line/gray) del sistema de diseño.

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} aria-hidden="true" />;
}

// Card de contenido orgánico (IG/YT): thumbnail + 2 líneas + meta. Coincide con ContentGrid.
export function ContentCardSkeleton() {
  return (
    <div className="bg-white rounded-xl overflow-hidden border border-line">
      <Skeleton className="w-full pt-[120%] rounded-none" />
      <div className="p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

// Card de anuncio (Ads): thumbnail cuadrado + anunciante + copy. Coincide con AdsView grid.
export function AdCardSkeleton() {
  return (
    <div className="bg-white rounded-xl overflow-hidden border border-line">
      <Skeleton className="w-full pt-[100%] rounded-none" />
      <div className="p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

// Fila de tabla (Fuentes o vista tabla). columns = número de celdas.
export function RowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-line">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === 0 ? 'flex-1' : 'w-16'}`} />
      ))}
    </div>
  );
}

// Grid de N skeletons (para la primera carga de una galería).
export function CardGridSkeleton({ count = 10, variant = 'content' }: { count?: number; variant?: 'content' | 'ad' }) {
  const min = variant === 'ad' ? '190px' : '160px';
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (variant === 'ad' ? <AdCardSkeleton key={i} /> : <ContentCardSkeleton key={i} />))}
    </div>
  );
}
