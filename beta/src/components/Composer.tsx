'use client';

import { useEffect, useRef, useState } from 'react';
import { useLang } from '@/lib/i18n/provider';
import { useSpeech } from './useSpeech';
import { setKeyboardOpen } from './useKeyboard';

/**
 * Bottom-anchored composer: one line growing to ~4, then internal scroll.
 * Mic + send sit on the RIGHT. Voice via the hardened useSpeech hook.
 */
export default function Composer({
  onSend,
  onStop,
  placeholder,
  busy,
  initialText,
}: {
  onSend: (text: string) => Promise<void> | void;
  /** called when the user taps the stop button while busy; the sent text is restored */
  onStop?: () => void;
  placeholder: string;
  busy?: boolean;
  /** when this changes, the composer adopts it as its text */
  initialText?: string;
}) {
  const [text, setText] = useState('');
  const sentRef = useRef('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const { t, lang } = useLang();
  const { listening, supported: speechOK, toggle: toggleMic, stop: stopMic } = useSpeech(lang, setText);

  useEffect(() => {
    if (initialText) {
      setText(initialText);
      taRef.current?.focus();
    }
  }, [initialText]);

  const send = async () => {
    const v = text.trim();
    if (!v || busy) return;
    stopMic();
    sentRef.current = v; // keep it so "stop" can put her words back
    setText('');
    await onSend(v);
    sentRef.current = '';
    taRef.current?.focus();
  };

  const stop = () => {
    // Put her words back so she can edit and resend.
    setText(sentRef.current);
    sentRef.current = '';
    onStop?.();
    taRef.current?.focus();
  };

  const onMic = () => toggleMic(text);

  return (
    <div className="flex items-end gap-2 rounded-2xl bg-card2 border border-line pl-4 pr-2 py-2">
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends (Shift+Enter = newline); ignore Enter while IME composition is active
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder}
        aria-label={t('capture.placeholder')}
        onFocus={() => setKeyboardOpen(true)}
        onBlur={() => setKeyboardOpen(false)}
        className="composer-input flex-1 bg-transparent outline-none resize-none text-[15px] leading-6 placeholder:text-faint py-1.5"
      />
      <div className="flex items-center gap-1 pb-0.5 shrink-0">
        {speechOK && (
          <button
            onClick={onMic}
            aria-label={t('common.voiceInput')}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-fast active:scale-90 ${
              listening ? 'bg-accent' : 'bg-card text-muted active:bg-line'
            }`}
          >
            {listening ? (
              <span className="rec-dot w-3 h-3 rounded-full bg-white" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={() => (busy ? stop() : void send())}
          disabled={!busy && !text.trim()}
          aria-label={busy ? t('common.stop') : t('common.send')}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-fast active:scale-90 ${
            busy
              ? 'bg-accent text-white'
              : text.trim()
                ? 'bg-accent text-white'
                : 'bg-card text-faint'
          }`}
        >
          {busy ? (
            <span className="w-3.5 h-3.5 rounded-[4px] bg-white" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
