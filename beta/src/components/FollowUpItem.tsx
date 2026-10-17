'use client';

import { useEffect, useRef, useState } from 'react';
import InlineField from './InlineField';
import { useLang } from '@/lib/i18n/provider';

export type FollowUp = {
  id: string;
  text: string;
  dueDate: string | null;
  done: boolean;
  personId: string | null;
  personName?: string | null;
};

/** Checkbox + long-press (600ms) to edit text/due date/delete. */
export default function FollowUpItem({
  item,
  showPerson,
  onChange,
}: {
  item: FollowUp;
  showPerson?: boolean;
  onChange: () => void;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [due, setDue] = useState(item.dueDate ?? '');
  const [pressing, setPressing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDue(item.dueDate ?? '');
  }, [item.dueDate]);

  const startPress = () => {
    setPressing(true);
    timer.current = setTimeout(() => {
      setEditing(true);
      setPressing(false);
    }, 550);
  };
  const endPress = () => {
    setPressing(false);
    if (timer.current) clearTimeout(timer.current);
  };

  const toggleDone = async () => {
    await fetch(`/api/followups/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !item.done }),
    });
    onChange();
  };

  const remove = async () => {
    await fetch(`/api/followups/${item.id}`, { method: 'DELETE' });
    onChange();
  };

  const saveDue = async () => {
    if (due !== (item.dueDate ?? '')) {
      await fetch(`/api/followups/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: due || null }),
      });
      onChange();
    }
  };

  return (
    <div className={`flex items-start gap-3 px-1 py-2.5 pressable ${pressing ? 'pressing' : ''}`}>
      <button
        onClick={toggleDone}
        aria-label={t('followups.markDone')}
        className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 transition-fast active:scale-90 flex items-center justify-center ${
          item.done ? 'bg-leaf border-leaf' : 'border-faint'
        }`}
      >
        {item.done && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0b0b0d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      <div
        className="flex-1 min-w-0"
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onTouchMove={endPress}
        onMouseDown={startPress}
        onMouseUp={endPress}
        onMouseLeave={endPress}
        onContextMenu={(e) => {
          e.preventDefault();
          setEditing(true);
        }}
      >
        {editing ? (
          <div className="fade-up">
            <div className="text-[15px] text-cream">
              <InlineField
                value={item.text}
                multiline
                ariaLabel={t('followups.title')}
                onSave={async (v) => {
                  if (v && v !== item.text) {
                    await fetch(`/api/followups/${item.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ text: v }),
                    });
                  }
                  setEditing(false);
                  onChange();
                }}
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                onBlur={() => void saveDue()}
                className="rounded-lg bg-card2 border border-line px-2 py-1 text-[13px] text-cream outline-none"
                style={{ colorScheme: 'light' }}
              />
              <button
                onClick={remove}
                className="text-[13px] text-accent font-medium px-2 py-1 active:scale-95 transition-fast"
              >
                {t('common.delete')}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-[13px] text-muted font-medium px-2 py-1 active:scale-95 transition-fast"
              >
                {t('common.done')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p
              className={`text-[15px] leading-snug ${item.done ? 'line-through text-faint' : 'text-cream'}`}
            >
              {item.text}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {showPerson && item.personName && (
                <span className="text-[12px] text-faint">{item.personName}</span>
              )}
              {item.dueDate && (
                <span className="text-[12px] text-accent font-medium">{item.dueDate}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
