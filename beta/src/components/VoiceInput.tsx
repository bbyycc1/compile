'use client';

import { useLang } from '@/lib/i18n/provider';
import { useSpeech } from './useSpeech';

/** Compact single-line input with mic + send on the right. */
export default function VoiceInput({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  const { t, lang } = useLang();
  const { listening, supported, toggle } = useSpeech(lang, onChange);

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-card2 border border-line pl-4 pr-2 py-1.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-faint py-1"
      />
      {supported && (
        <button
          onClick={() => toggle(value)}
          aria-label={t('common.voiceInput')}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-fast active:scale-90 ${
            listening ? 'bg-accent' : 'text-muted active:bg-card'
          }`}
        >
          {listening ? (
            <span className="rec-dot w-2.5 h-2.5 rounded-full bg-white" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}
        </button>
      )}
      <button
        onClick={onSubmit}
        disabled={!value.trim()}
        aria-label={t('common.send')}
        className={`w-9 h-9 rounded-full flex items-center justify-center transition-fast active:scale-90 ${
          value.trim() ? 'bg-accent text-white' : 'text-faint'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
}
