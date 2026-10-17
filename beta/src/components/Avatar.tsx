'use client';

import AvatarFigure, { hasAvatarSpec, type AvatarSpec } from './AvatarFigure';

const PALETTE = ['#c96f5a', '#8a7bd8', '#5aa3c9', '#6fbf8a', '#c9a35a', '#b85a8a'] as const;

export function paletteColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initialOf(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  // CJK: first char; latin: first char uppercased
  const ch = t[0];
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
}

/** Neutral warm gray letter avatar; photo if present; abstract figure if described; subtle "looking up" shimmer while research runs. */
export default function Avatar({
  name,
  photo,
  color,
  spec,
  size = 44,
  rounded = 'rounded-full',
  onClick,
  lookingUp = false,
}: {
  name: string;
  photo?: string | null;
  color?: string | null;
  spec?: AvatarSpec | null;
  size?: number;
  rounded?: string;
  onClick?: () => void;
  lookingUp?: boolean;
}) {
  const bg = color || '#8a8a93';
  const showFigure = !photo && hasAvatarSpec(spec);
  return (
    <div
      onClick={onClick}
      className={`${rounded} overflow-hidden shrink-0 flex items-center justify-center transition-fast relative ${
        onClick ? 'cursor-pointer active:scale-95' : ''
      }`}
      style={{ width: size, height: size, background: photo ? '#222' : bg }}
    >
      {photo ? (
        <img src={photo} alt={name} className="w-full h-full object-cover" draggable={false} />
      ) : showFigure ? (
        <div className="w-full h-full p-[6%]">
          <AvatarFigure spec={spec!} />
        </div>
      ) : (
        <span
          className="font-semibold text-cream"
          style={{ fontSize: size * 0.42, color: '#ffffff' }}
        >
          {initialOf(name)}
        </span>
      )}
      {lookingUp && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-white/50"
          style={{ animationDuration: '1.2s' }}
        />
      )}
    </div>
  );
}

export { PALETTE };
