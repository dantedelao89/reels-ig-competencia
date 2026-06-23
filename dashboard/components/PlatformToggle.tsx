'use client';

import { InstagramIcon, YoutubeIcon } from './BrandIcons';

interface Props {
  platform: string;
  onPlatform: (v: string) => void;
}

const IG_GRADIENT = 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)';

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

      <button
        onClick={() => onPlatform('ig')}
        style={platform === 'ig' ? { background: IG_GRADIENT } : undefined}
        className={`h-8 px-3 text-sm rounded-md inline-flex items-center gap-1.5 ${
          platform === 'ig' ? 'text-white font-medium' : 'hover:bg-gray-50'
        }`}
      >
        <InstagramIcon size={15} className={platform === 'ig' ? 'text-white' : 'text-[#C13584]'} />
        <span className={platform === 'ig' ? 'text-white' : 'text-gray-600'}>Instagram</span>
      </button>

      <button
        onClick={() => onPlatform('yt')}
        className={`h-8 px-3 text-sm rounded-md inline-flex items-center gap-1.5 ${
          platform === 'yt' ? 'bg-[#FF0000] text-white font-medium' : 'hover:bg-gray-50'
        }`}
      >
        <YoutubeIcon size={16} className={platform === 'yt' ? 'text-white' : 'text-[#FF0000]'} />
        <span className={platform === 'yt' ? 'text-white' : 'text-gray-600'}>YouTube</span>
      </button>
    </div>
  );
}
