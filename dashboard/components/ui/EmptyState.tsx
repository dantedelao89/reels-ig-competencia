// Estado vacío: petición exitosa pero sin datos. Mensaje claro + CTA opcional.
// Reutilizable: recibe icono, título, descripción y una acción.

import { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export default function EmptyState({ icon, title, description, actionLabel, onAction, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-4 ${className}`}>
      {icon && <div className="text-3xl mb-3 opacity-80" aria-hidden="true">{icon}</div>}
      <div className="text-sm font-medium text-gray-700">{title}</div>
      {description && <div className="text-xs text-muted mt-1 max-w-xs">{description}</div>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 h-9 px-4 text-sm rounded-lg bg-accent text-white font-medium hover:opacity-90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
