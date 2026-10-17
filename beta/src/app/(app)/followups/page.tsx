'use client';

import { useCallback, useEffect, useState } from 'react';
import FollowUpItem, { type FollowUp } from '@/components/FollowUpItem';
import { useLang } from '@/lib/i18n/provider';
import { useSpeech } from '@/components/useSpeech';
import { parseDateHint } from '@/lib/date-hint';

export default function FollowUpsPage() {
  const { t, lang } = useLang();
  const [items, setItems] = useState<FollowUp[]>([]);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [autoDue, setAutoDue] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/followups');
    if (res.ok) {
      const data = await res.json();
      setItems(data.followUps);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onTextChange = (v: string) => {
    setText(v);
    // auto-fill the date from natural language ("tomorrow", "this monday", "9/16")
    // only when the user hasn't picked a date themselves
    if (!due) {
      const hint = parseDateHint(v);
      setDue(hint ?? '');
      setAutoDue(!!hint);
    }
  };

  const { listening, supported: speechOK, toggle: toggleMic } = useSpeech(lang, onTextChange);

  const onDueChange = (v: string) => {
    setDue(v);
    setAutoDue(false);
  };

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    const finalDue = due || parseDateHint(v) || null;
    await fetch('/api/followups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: v, dueDate: finalDue }),
    });
    setText('');
    setDue('');
    setAutoDue(false);
    await load();
  };

  const byDue = (a: FollowUp, b: FollowUp) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  };
  const open = items.filter((i) => !i.done).sort(byDue);
  const done = items.filter((i) => i.done);

  return (
    <div className="px-4 pt-8 pb-4 lg:max-w-5xl w-full">
      <h1 className="text-[26px] font-bold tracking-tight">{t('followups.title')}</h1>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder={t('followups.addPlaceholder')}
          className="w-full rounded-2xl bg-card2 border border-line px-4 py-2.5 text-[15px] outline-none focus:border-accent placeholder:text-faint sm:flex-1"
        />
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 sm:flex-none">
            <span className="text-[13px] text-faint sm:hidden">{t('followups.due')}</span>
            <input
              type="date"
              value={due}
              onChange={(e) => onDueChange(e.target.value)}
              className="flex-1 rounded-2xl bg-card2 border border-line px-2 py-2.5 text-[14px] outline-none text-muted sm:w-[150px] sm:flex-none"
              style={{ colorScheme: 'light' }}
              aria-label={t('followups.due')}
            />
          </label>
          <button
            onClick={() => void add()}
            disabled={!text.trim()}
            className="w-10 h-10 shrink-0 rounded-full bg-accent text-ink font-bold text-xl active:scale-90 transition-fast disabled:opacity-30"
          >
            +
          </button>
          {speechOK && (
            <button
              onClick={() => toggleMic(text)}
              aria-label={t('common.voiceInput')}
              className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-fast active:scale-90 ${
                listening ? 'bg-accent text-white' : 'bg-card2 border border-line text-muted'
              }`}
            >
              {listening ? (
                <span className="rec-dot w-3 h-3 rounded-full bg-white" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      {autoDue && due && (
        <p className="mt-1.5 text-[12px] text-faint">{t('followups.autoDate')}</p>
      )}

      {open.length > 0 && (
        <div className="mt-4 divide-y divide-line/60">
          {open.map((i) => (
            <FollowUpItem key={i.id} item={i} showPerson onChange={load} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-6">
          <p className="text-[12px] font-medium text-faint mb-1">{t('followups.doneSection')}</p>
          <div className="divide-y divide-line/60 opacity-70">
            {done.map((i) => (
              <FollowUpItem key={i.id} item={i} showPerson onChange={load} />
            ))}
          </div>
        </div>
      )}

      {loaded && items.length === 0 && (
        <p className="mt-10 text-center text-[14px] text-faint">{t('followups.empty')}</p>
      )}
    </div>
  );
}
