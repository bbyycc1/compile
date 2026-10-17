'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import ConfirmDialog from './ConfirmDialog';
import { useLang } from '@/lib/i18n/provider';
import type { PersonCard } from '@/lib/people-queries';

/** Compact person row. Mobile: swipe-left-to-delete. Desktop: right-click menu. */
export default function PersonRow({
  person,
  onDelete,
  onSelect,
  selected,
}: {
  person: PersonCard;
  onDelete?: (id: string) => Promise<void> | void;
  /** when set (desktop master-detail), rows select instead of navigating */
  onSelect?: (id: string) => void;
  selected?: boolean;
}) {
  const { t } = useLang();
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const startX = useRef(0);
  const startOffset = useRef(0);
  // Mirrors `offset` state but updates synchronously, so touch handlers never
  // read a stale value when React hasn't re-rendered yet mid-gesture.
  const offsetRef = useRef(0);
  const dragging = useRef(false);

  const reveal = -76;

  const applyOffset = (v: number) => {
    offsetRef.current = v;
    setOffset(v);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startOffset.current = offsetRef.current;
    dragging.current = true;
    setDragActive(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current || !onDelete) return;
    const dx = e.touches[0].clientX - startX.current;
    applyOffset(Math.max(reveal, Math.min(0, startOffset.current + dx)));
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setDragActive(false);
    applyOffset(offsetRef.current < reveal / 2 ? reveal : 0);
  };

  const primaryTag = person.tags[0];

  return (
    <>
      <div className="relative overflow-hidden">
        {onDelete && (
          <button
            onClick={() => setConfirming(true)}
            className="absolute right-0 top-0 bottom-0 w-[76px] bg-accent text-ink text-[13px] font-semibold flex items-center justify-center"
          >
            {t('common.delete')}
          </button>
        )}
        <div
          className="swipe-row relative bg-ink"
          style={{
            transform: `translateX(${offset}px)`,
            transition: dragActive ? 'none' : 'transform 0.16s ease-out',
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={endDrag}
          onTouchCancel={endDrag}
          onContextMenu={(e) => {
            if (!onDelete) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <Link
            href={`/people/${person.id}`}
            className={`flex items-center gap-3 px-4 py-3 active:bg-card2 ${selected ? 'bg-card2' : ''}`}
            onClick={(e) => {
              if (onSelect) {
                e.preventDefault();
                onSelect(person.id);
              } else if (offsetRef.current !== 0) {
                applyOffset(0);
              }
            }}
          >
            <Avatar
              name={person.name}
              photo={person.avatarPhoto}
              color={person.avatarColor || (primaryTag?.color ?? undefined)}
              spec={person.avatarSpec}
              size={44}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold truncate">{person.name}</p>
              {person.headline ? (
                <p className="text-[13px] text-muted truncate">{person.headline}</p>
              ) : person.occasions.length > 0 ? (
                <p className="text-[13px] text-faint truncate">{person.occasions.join(' · ')}</p>
              ) : null}
            </div>
            {person.tags.length > 0 && (
              <span
                className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{
                  background: `${primaryTag?.color ?? '#8a8a93'}22`,
                  color: primaryTag?.color ?? '#8a8a93',
                  border: `1px solid ${primaryTag?.color ?? '#8a8a93'}55`,
                }}
              >
                {primaryTag?.name}
              </span>
            )}
          </Link>
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title={t('people.deleteTitle')}
          message={t('people.deleteBody')}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            setOffset(0);
            await onDelete?.(person.id);
          }}
        />
      )}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 rounded-xl bg-card2 border border-line shadow-xl py-1 min-w-[140px]"
            style={{ left: Math.min(menu.x, window.innerWidth - 160), top: menu.y }}
          >
            <button
              onClick={() => {
                setMenu(null);
                setConfirming(true);
              }}
              className="w-full text-left px-4 py-2.5 text-[14px] text-accent hover:bg-card transition-fast"
            >
              {t('common.delete')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
