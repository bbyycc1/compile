'use client';

import Link from 'next/link';
import { useLang } from '@/lib/i18n/provider';

export type Tag = { id: string; name: string; color: string | null };

/** One horizontally scrollable bar of tag chips (never more than one row). */
export default function TagBar({
  tags,
  activeId,
  onSelect,
}: {
  tags: Tag[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useLang();
  return (
    <div className="nice-scroll flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
      <button
        onClick={() => onSelect(null)}
        className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-fast active:scale-95 ${
          activeId === null ? 'bg-cream text-ink' : 'bg-card2 border border-line text-muted'
        }`}
      >
        {t('common.all')}
      </button>
      {tags.map((tag) => {
        const active = activeId === tag.id;
        const color = tag.color ?? '#8a8a93';
        return (
          <button
            key={tag.id}
            onClick={() => onSelect(active ? null : tag.id)}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-fast active:scale-95 flex items-center gap-1.5"
            style={
              active
                ? { background: color, color: '#ffffff' }
                : {
                    background: `${color}1a`,
                    color,
                    border: `1px solid ${color}44`,
                  }
            }
          >
            {!active && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
