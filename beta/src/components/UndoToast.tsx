'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n/provider';
import type { PersonSnapshot } from '@/lib/person-snapshot';

/** Global undo toast for person deletes. Any component can trigger it via requestUndoDelete(). */
export function requestUndoDelete(snapshot: PersonSnapshot) {
  window.dispatchEvent(new CustomEvent<PersonSnapshot>('undo-delete', { detail: snapshot }));
}

export default function UndoToast() {
  const { t } = useLang();
  const [snap, setSnap] = useState<PersonSnapshot | null>(null);

  useEffect(() => {
    const onUndo = (e: Event) => {
      setSnap((e as CustomEvent<PersonSnapshot>).detail);
    };
    window.addEventListener('undo-delete', onUndo);
    return () => window.removeEventListener('undo-delete', onUndo);
  }, []);

  useEffect(() => {
    if (!snap) return;
    const id = setTimeout(() => setSnap(null), 20000);
    return () => clearTimeout(id);
  }, [snap]);

  const doUndo = async () => {
    if (!snap) return;
    const s = snap;
    setSnap(null);
    try {
      await fetch('/api/people/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: s }),
      });
      // Let lists refresh.
      window.dispatchEvent(new Event('people-changed'));
    } catch {}
  };

  if (!snap) return null;
  return (
    <div className="fixed bottom-20 lg:bottom-8 left-0 right-0 z-50 px-4 pointer-events-none">
      <div className="max-w-xl mx-auto flex items-center justify-between gap-3 rounded-full bg-ink text-paper pl-4 pr-2 py-2 shadow-lg pointer-events-auto">
        <span className="text-[13px] truncate">Deleted {snap.person.name}.</span>
        <button
          onClick={doUndo}
          className="shrink-0 rounded-full bg-accent text-white text-[13px] font-semibold px-4 py-1.5"
        >
          {t('capture.undo')}
        </button>
      </div>
    </div>
  );
}
