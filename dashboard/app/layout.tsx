import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DISECTA — Espionaje',
  description: 'DISECTA · Espionaje de reels y videos de la competencia',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
