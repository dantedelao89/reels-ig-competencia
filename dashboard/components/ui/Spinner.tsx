// Spinner reutilizable para acciones puntuales cortas (botones, cargas pequeñas).
// Respeta el token de color: por defecto usa currentColor, así hereda el color del contexto.

interface Props {
  size?: number; // px
  className?: string;
}

export default function Spinner({ size = 16, className = '' }: Props) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
