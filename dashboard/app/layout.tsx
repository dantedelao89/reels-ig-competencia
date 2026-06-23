import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Inteligencia competitiva',
  description: 'Dashboard de curación de reels y videos',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
