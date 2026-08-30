'use client';

// Filtro de plataforma. Se dibuja a partir del registro (lib/platforms.ts), así que añadir una
// plataforma nueva no toca este archivo: basta con su entrada en PLATFORMS.

import type { ComponentType } from 'react';
import { InstagramIcon, YoutubeIcon, TiktokIcon, XIcon } from './BrandIcons';
import { PLATFORMS, PLATFORM_ORDER } from '@/lib/platforms';

interface Props {
  platform: string;
  onPlatform: (v: string) => void;
}

// El registro no puede traer componentes (lo importan route handlers de servidor), así que
// resuelve la clave de texto aquí.
const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  instagram: InstagramIcon,
  youtube: YoutubeIcon,
  tiktok: TiktokIcon,
  x: XIcon,
};

const COLOR_INACTIVO: Record<string, string> = {
  instagram: 'text-[#C13584]',
  youtube: 'text-[#FF0000]',
  tiktok: 'text-black',
  x: 'text-black',
};

export default function PlatformToggle({ platform, onPlatform }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-white p-0.5">
      <button
        onClick={() => onPlatform('all')}
        className={`h-8 px-3 text-sm rounded-md ${
          platform === 'all' ? 'bg-ink text-white font-medium' : 'text-gray-600 hover:bg-gray-50'
        }`}
      >
        Todo
      </button>

      {PLATFORM_ORDER.map((key) => {
        const def = PLATFORMS[key];
        const Icon = ICONS[def.icon];
        const activo = platform === key;
        return (
          <button
            key={key}
            onClick={() => onPlatform(key)}
            style={activo ? def.activeStyle : undefined}
            className={`h-8 px-3 text-sm rounded-md inline-flex items-center gap-1.5 ${
              activo ? `${def.activeClass} font-medium` : 'hover:bg-gray-50'
            }`}
          >
            {Icon && <Icon size={15} className={activo ? 'text-white' : COLOR_INACTIVO[def.icon]} />}
            <span className={activo ? 'text-white' : 'text-gray-600'}>{def.label}</span>
          </button>
        );
      })}
    </div>
  );
}
