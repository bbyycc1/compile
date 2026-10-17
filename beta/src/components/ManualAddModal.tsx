'use client';

import { useState } from 'react';
import { useLang } from '@/lib/i18n/provider';

type Draft = { name: string; headline: string; company: string; roleTitle: string };

/** Manual add-person: quick form → "Does this look right?" review → save. */
export default function ManualAddModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (personId: string) => void;
}) {
  const { t } = useLang();
  const [draft, setDraft] = useState<Draft>({ name: '', headline: '', company: '', roleTitle: '' });
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          headline: draft.headline.trim() || null,
          company: draft.company.trim() || null,
          roleTitle: draft.roleTitle.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.personId) onSaved(data.personId);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, k: keyof Draft, autoFocus = false) => (
    <label className="block">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <input
        value={draft[k]}
        onChange={set(k)}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.name.trim()) setReviewing(true);
        }}
        className="mt-1 w-full rounded-2xl bg-card border border-line px-4 py-2.5 text-[15px] outline-none focus:border-accent placeholder:text-faint"
      />
    </label>
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/70" onClick={onClose} />
      <div className="bloom fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md rounded-3xl bg-card2 border border-line p-6 shadow-2xl">
        {!reviewing ? (
          <>
            <h2 className="text-[20px] font-bold tracking-tight">{t('manualAdd.title')}</h2>
            <div className="mt-4 space-y-3">
              {field(t('manualAdd.name'), 'name', true)}
              {field(t('manualAdd.headline'), 'headline')}
              {field(t('manualAdd.company'), 'company')}
              {field(t('manualAdd.role'), 'roleTitle')}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-2xl border border-line py-2.5 text-[14px] font-medium text-muted active:scale-[0.98] transition-fast"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => draft.name.trim() && setReviewing(true)}
                disabled={!draft.name.trim()}
                className="flex-1 rounded-2xl bg-accent py-2.5 text-[14px] font-semibold text-ink active:scale-[0.98] transition-fast disabled:opacity-40"
              >
                {t('common.done')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[20px] font-bold tracking-tight">{t('manualAdd.review')}</h2>
            <div className="mt-4 rounded-2xl bg-card border border-line p-4 space-y-1.5">
              <p className="text-[17px] font-semibold">{draft.name}</p>
              {draft.headline.trim() && <p className="text-[14px] text-muted">{draft.headline}</p>}
              {draft.company.trim() && (
                <p className="text-[14px] text-muted">
                  {draft.company}
                  {draft.roleTitle.trim() ? ` · ${draft.roleTitle}` : ''}
                </p>
              )}
              {!draft.headline.trim() && draft.roleTitle.trim() && !draft.company.trim() && (
                <p className="text-[14px] text-muted">{draft.roleTitle}</p>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setReviewing(false)}
                className="flex-1 rounded-2xl border border-line py-2.5 text-[14px] font-medium text-muted active:scale-[0.98] transition-fast"
              >
                {t('manualAdd.editDetails')}
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="flex-1 rounded-2xl bg-accent py-2.5 text-[14px] font-semibold text-ink active:scale-[0.98] transition-fast disabled:opacity-50"
              >
                {saving ? '…' : t('manualAdd.savePerson')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
