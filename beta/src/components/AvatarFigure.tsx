'use client';

export type AvatarSpec = {
  skin?: string | null;
  hairStyle?: string | null;
  hairTexture?: string | null;
  hairColor?: string | null;
  fringe?: string | null;
  glasses?: string | null;
  glassesColor?: string | null;
  beard?: string | null;
};

export const SKIN_TONES = [
  { id: 'light', color: '#f6d7b8' },
  { id: 'medium-light', color: '#eebd8d' },
  { id: 'medium', color: '#d19a66' },
  { id: 'medium-dark', color: '#9c6b43' },
  { id: 'dark', color: '#6b4226' },
] as const;

export const HAIR_STYLES = [
  { id: 'bald', label: 'Bald' },
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
  { id: 'bun', label: 'Bun' },
] as const;

export const HAIR_TEXTURES = [
  { id: 'straight', label: 'Straight' },
  { id: 'curly', label: 'Curly' },
] as const;

export const FRINGE_STYLES = [
  { id: 'none', label: 'No fringe' },
  { id: 'fringe', label: 'Fringe' },
] as const;

export const HAIR_COLORS = [
  { id: 'black', color: '#232323' },
  { id: 'brown', color: '#5a3a22' },
  { id: 'blonde', color: '#e3c168' },
  { id: 'red', color: '#b5502a' },
  { id: 'gray', color: '#b5b5b5' },
  { id: 'white', color: '#efefef' },
] as const;

export const GLASSES_STYLES = [
  { id: 'none', label: 'None' },
  { id: 'rect', label: 'Rectangular' },
  { id: 'round', label: 'Round' },
] as const;

export const GLASSES_COLORS = [
  { id: 'black', color: '#2b2b30' },
  { id: 'brown', color: '#6b4a2f' },
  { id: 'gold', color: '#c9a227' },
  { id: 'silver', color: '#a8b0b8' },
] as const;

export const BEARD_STYLES = [
  { id: 'none', label: 'None' },
  { id: 'short', label: 'Short beard' },
  { id: 'full', label: 'Full beard' },
] as const;

const skinColor = (id?: string | null) =>
  SKIN_TONES.find((s) => s.id === id)?.color ?? SKIN_TONES[2].color;
const hairColor = (id?: string | null) =>
  HAIR_COLORS.find((h) => h.id === id)?.color ?? HAIR_COLORS[0].color;
const glassesColor = (id?: string | null) =>
  GLASSES_COLORS.find((g) => g.id === id)?.color ?? GLASSES_COLORS[0].color;

/**
 * Abstract headshot from building blocks — chess.com style, not a portrait.
 * Deliberately vague: it encodes only the few features people can actually
 * verbalize (skin tone, hair style/texture/color, glasses, beard), so it can
 * never be "wrong" the way an AI-generated face can.
 */
export default function AvatarFigure({ spec }: { spec: AvatarSpec }) {
  const skin = skinColor(spec.skin);
  const hair = hairColor(spec.hairColor);
  const style = spec.hairStyle ?? 'short';
  const curly = spec.hairTexture === 'curly';
  const fringe = spec.fringe === 'fringe';
  const glasses = spec.glasses && spec.glasses !== 'none' ? spec.glasses : null;
  const gColor = glassesColor(spec.glassesColor);
  const beard = spec.beard && spec.beard !== 'none' ? spec.beard : null;

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
      {/* long hair back layer */}
      {style === 'long' &&
        (curly ? (
          <g fill={hair}>
            {[22, 34, 46, 58, 70, 80].map((y) => (
              <circle key={'l' + y} cx="30" cy={y} r="8" />
            ))}
            {[22, 34, 46, 58, 70, 80].map((y) => (
              <circle key={'r' + y} cx="70" cy={y} r="8" />
            ))}
          </g>
        ) : (
          <g fill={hair}>
            <rect x="24" y="16" width="13" height="70" rx="6.5" />
            <rect x="63" y="16" width="13" height="70" rx="6.5" />
          </g>
        ))}
      {/* shoulders */}
      <path d="M16,100 C16,74 32,67 50,67 C68,67 84,74 84,100 Z" fill="#83838e" />
      {/* neck */}
      <rect x="43" y="58" width="14" height="14" rx="5" fill={skin} />
      {/* ears */}
      <circle cx="29.5" cy="44" r="4.5" fill={skin} />
      <circle cx="70.5" cy="44" r="4.5" fill={skin} />
      {/* head */}
      <ellipse cx="50" cy="42" rx="20" ry="24" fill={skin} />
      {/* hair top: straight cap (middle part, no fringe by default) vs curly cluster */}
      {style !== 'bald' &&
        (curly ? (
          <g fill={hair}>
            <circle cx="36" cy="24" r="9" />
            <circle cx="50" cy="17" r="10" />
            <circle cx="64" cy="24" r="9" />
            <circle cx="30" cy="33" r="7.5" />
            <circle cx="70" cy="33" r="7.5" />
          </g>
        ) : fringe ? (
          <ellipse cx="50" cy="25" rx="21" ry="12" fill={hair} />
        ) : (
          <g>
            <ellipse cx="50" cy="19" rx="21" ry="9" fill={hair} />
            {/* middle part */}
            <line x1="50" y1="21.5" x2="50" y2="27" stroke={skin} strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
      {style === 'medium' &&
        (curly ? (
          <g fill={hair}>
            {[30, 42, 54].map((y) => (
              <circle key={'l' + y} cx="30" cy={y} r="7" />
            ))}
            {[30, 42, 54].map((y) => (
              <circle key={'r' + y} cx="70" cy={y} r="7" />
            ))}
          </g>
        ) : (
          <g fill={hair}>
            <rect x="27" y="24" width="9" height="30" rx="4.5" />
            <rect x="64" y="24" width="9" height="30" rx="4.5" />
          </g>
        ))}
      {style === 'bun' && <circle cx="50" cy="11" r="9" fill={hair} />}
      {/* beard */}
      {beard === 'short' && (
        <path
          d="M34,52 C37,63 43,68 50,68 C57,68 63,63 66,52 C63,59 57,63 50,63 C43,63 37,59 34,52 Z"
          fill={hair}
        />
      )}
      {beard === 'full' && (
        <path
          d="M31,46 C32,62 40,72 50,72 C60,72 68,62 69,46 L63,50 C62,58 56,64 50,64 C44,64 38,58 37,50 Z"
          fill={hair}
        />
      )}
      {/* glasses */}
      {glasses === 'round' && (
        <g stroke={gColor} strokeWidth="2.6" fill="none" strokeLinecap="round">
          <circle cx="39" cy="44" r="7.5" />
          <circle cx="61" cy="44" r="7.5" />
          <line x1="46.5" y1="44" x2="53.5" y2="44" />
          <line x1="31.5" y1="42" x2="27" y2="40" />
          <line x1="68.5" y1="42" x2="73" y2="40" />
        </g>
      )}
      {glasses === 'rect' && (
        <g stroke={gColor} strokeWidth="2.6" fill="rgba(255,255,255,0.12)" strokeLinecap="round">
          <rect x="30.5" y="37" width="17" height="14" rx="3.5" />
          <rect x="52.5" y="37" width="17" height="14" rx="3.5" />
          <line x1="47.5" y1="42" x2="52.5" y2="42" />
          <line x1="30.5" y1="42" x2="27" y2="40" />
          <line x1="69.5" y1="42" x2="73" y2="40" />
        </g>
      )}
    </svg>
  );
}

/** True when the spec carries at least one described attribute. */
export function hasAvatarSpec(spec: AvatarSpec | null | undefined): spec is AvatarSpec {
  return (
    !!spec &&
    !!(spec.skin || spec.hairStyle || spec.hairTexture || spec.hairColor || spec.fringe || spec.glasses || spec.beard)
  );
}
