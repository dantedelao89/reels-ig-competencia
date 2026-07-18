// Barra de progreso para procesos con duración medible (uploads). value 0–100.
// Si value es null/undefined → modo indeterminado (barra que se desliza).

interface Props {
  value?: number | null; // 0-100; null = indeterminado
  className?: string;
}

export default function ProgressBar({ value, className = '' }: Props) {
  const indeterminate = value == null;
  const pct = indeterminate ? 40 : Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 w-full rounded-full bg-gray-200 overflow-hidden ${className}`}>
      <div
        className={`h-full bg-accent rounded-full transition-[width] duration-200 ease-out ${
          indeterminate ? 'animate-[progress-indet_1.1s_ease-in-out_infinite]' : ''
        }`}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
