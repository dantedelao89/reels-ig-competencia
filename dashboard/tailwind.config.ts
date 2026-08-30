import type { Config } from 'tailwindcss';

const config: Config = {
  // lib/ va incluido a propósito: el registro de plataformas (lib/platforms.ts) declara clases
  // como los ratios de miniatura. Sin este glob Tailwind no las genera y las imágenes quedan con
  // altura cero — pasó en producción al mover el ratio de ContentGrid al registro.
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0f1115',
          soft: '#1a1d24',
        },
        line: '#e6e7eb',
        muted: '#6b7280',
        accent: {
          DEFAULT: '#2563eb',
          soft: '#eff4ff',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Animaciones de estados de UI. Definidas aquí (no como clases arbitrarias animate-[...])
      // porque el shorthand arbitrario no aplicaba bien en el build de producción y dejaba el
      // toast en opacity:0. 'both' garantiza que el estado final (opacity 1) persista.
      keyframes: {
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'progress-indet': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(280%)' },
        },
      },
      animation: {
        'toast-in': 'toast-in 180ms ease-out both',
        'progress-indet': 'progress-indet 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
