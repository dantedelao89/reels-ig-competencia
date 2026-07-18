// Botón para acciones async: muestra su propio estado loading (spinner interno + deshabilitado)
// para evitar doble-click. Respeta el sistema de diseño; variantes primary/secondary.

import { ButtonHTMLAttributes, ReactNode } from 'react';
import Spinner from './Spinner';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}

const VARIANTS = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'border border-line bg-white text-gray-700 hover:bg-gray-50',
};

export default function AsyncButton({
  loading = false,
  loadingLabel,
  variant = 'primary',
  disabled,
  children,
  className = '',
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`inline-flex items-center justify-center gap-1.5 h-9 px-4 text-sm rounded-lg font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner size={14} />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}
