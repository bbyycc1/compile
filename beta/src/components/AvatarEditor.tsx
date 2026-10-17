'use client';

import { useState } from 'react';
import AvatarFigure, {
  SKIN_TONES,
  HAIR_STYLES,
  HAIR_TEXTURES,
  FRINGE_STYLES,
  HAIR_COLORS,
  GLASSES_STYLES,
  GLASSES_COLORS,
  BEARD_STYLES,
  type AvatarSpec,
} from './AvatarFigure';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <p className="text-[12px] font-medium text-faint mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-fast active:scale-95 ${
        active ? 'bg-accent text-ink border-accent' : 'bg-card2 border-line text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Swatch({
  color,
  active,
  onClick,
  label,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`w-9 h-9 rounded-full transition-fast active:scale-90 ${
        active ? 'ring-2 ring-accent ring-offset-2 ring-offset-card2' : 'ring-1 ring-line'
      }`}
      style={{ background: color }}
    />
  );
}

/** Manual building-block editor for the abstract avatar. */
export default function AvatarEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: AvatarSpec | null;
  onSave: (spec: AvatarSpec) => Promise<void>;
  onClose: () => void;
}) {
  const [spec, setSpec] = useState<AvatarSpec>({
    skin: initial?.skin ?? 'medium',
    hairStyle: initial?.hairStyle ?? 'short',
    hairTexture: initial?.hairTexture ?? 'straight',
    hairColor: initial?.hairColor ?? 'black',
    fringe: initial?.fringe ?? 'none',
    glasses: initial?.glasses ?? 'none',
    glassesColor: initial?.glassesColor ?? 'black',
    beard: initial?.beard ?? 'none',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof AvatarSpec, v: string) => setSpec((s) => ({ ...s, [k]: v }));

  return (
    <div className="p-1">
      <div className="flex justify-center py-2">
        <div className="w-24 h-24 rounded-full overflow-hidden bg-card2 border border-line p-1">
          <AvatarFigure spec={spec} />
        </div>
      </div>
      <Row label="Skin tone">
        {SKIN_TONES.map((s) => (
          <Swatch key={s.id} color={s.color} label={s.id} active={spec.skin === s.id} onClick={() => set('skin', s.id)} />
        ))}
      </Row>
      <Row label="Hair style">
        {HAIR_STYLES.map((s) => (
          <Chip key={s.id} active={spec.hairStyle === s.id} onClick={() => set('hairStyle', s.id)}>
            {s.label}
          </Chip>
        ))}
      </Row>
      <Row label="Hair texture">
        {HAIR_TEXTURES.map((s) => (
          <Chip key={s.id} active={spec.hairTexture === s.id} onClick={() => set('hairTexture', s.id)}>
            {s.label}
          </Chip>
        ))}
      </Row>
      <Row label="Hair color">
        {HAIR_COLORS.map((s) => (
          <Swatch key={s.id} color={s.color} label={s.id} active={spec.hairColor === s.id} onClick={() => set('hairColor', s.id)} />
        ))}
      </Row>
      <Row label="Fringe">
        {FRINGE_STYLES.map((s) => (
          <Chip key={s.id} active={(spec.fringe ?? 'none') === s.id} onClick={() => set('fringe', s.id)}>
            {s.label}
          </Chip>
        ))}
      </Row>
      <Row label="Glasses">
        {GLASSES_STYLES.map((s) => (
          <Chip key={s.id} active={spec.glasses === s.id} onClick={() => set('glasses', s.id)}>
            {s.label}
          </Chip>
        ))}
      </Row>
      {spec.glasses !== 'none' && (
        <Row label="Glasses color">
          {GLASSES_COLORS.map((s) => (
            <Swatch key={s.id} color={s.color} label={s.id} active={spec.glassesColor === s.id} onClick={() => set('glassesColor', s.id)} />
          ))}
        </Row>
      )}
      <Row label="Beard">
        {BEARD_STYLES.map((s) => (
          <Chip key={s.id} active={spec.beard === s.id} onClick={() => set('beard', s.id)}>
            {s.label}
          </Chip>
        ))}
      </Row>
      <div className="flex gap-2 pt-3">
        <button
          onClick={onClose}
          className="flex-1 rounded-2xl border border-line bg-card2 py-3 text-[14px] font-medium active:scale-[0.98] transition-fast"
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(spec);
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="flex-1 rounded-2xl bg-accent py-3 text-[14px] font-semibold text-ink active:scale-[0.98] transition-fast disabled:opacity-50"
        >
          {saving ? '…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
