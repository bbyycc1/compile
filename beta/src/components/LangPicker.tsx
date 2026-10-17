'use client';

import { useLang } from '@/lib/i18n/provider';
import { LANGS } from '@/lib/i18n/dict';

/** Compact language picker for logged-out screens (login / signup). */
export default function LangPicker() {
  const { lang, setLang } = useLang();
  return (
    <div className="mt-8 flex items-center justify-center gap-1.5">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => setLang(l.id)}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-fast active:scale-95 ${
            lang === l.id
              ? 'bg-accent text-white'
              : 'text-faint active:text-muted'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
