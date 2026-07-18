import type { Metadata } from 'next';
import './globals.css';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'DISECTA — Espionaje',
  description: 'DISECTA · Espionaje de reels y videos de la competencia',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ErrorBoundary>
          <ToastProvider>{children}</ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
