'use client';

import { useState } from 'react';
import { useLang } from '@/lib/i18n/provider';
import type { Lang } from '@/lib/i18n/dict';

/** Storage key for "user has picked a language". Bumping the suffix re-shows the gate for everyone. */
const GATE_KEY = 'langgate_v1';

const CHOICES: { id: Lang; native: string }[] = [
  { id: 'en', native: 'English' },
  { id: 'zh-Hans', native: '简体中文' },
  { id: 'zh-Hant', native: '繁體中文' },
  { id: 'es', native: 'Español' },
];

function alreadyPicked(): boolean {
  if (typeof window === 'undefined') return true; // SSR: render children, decide on client
  try {
    return localStorage.getItem(GATE_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * Full-screen language chooser shown before the login/signup form until the
 * visitor picks a language. Once picked, the choice is remembered and the
 * gate never shows again (until GATE_KEY is bumped).
 */
export default function LangGate({ children }: { children: React.ReactNode }) {
  const { setLang } = useLang();
  const [picked, setPicked] = useState<boolean>(alreadyPicked);

  if (picked) return <>{children}</>;

  const pick = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem(GATE_KEY, '1');
    } catch {}
    setPicked(true);
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="w-full max-w-sm fade-up">
        <h1 className="text-center text-[22px] font-bold tracking-tight leading-snug">
          Choose your language
          <br />
          <span className="text-muted font-medium">选择语言 · 選擇語言 · Elige tu idioma</span>
        </h1>
        <div className="mt-8 space-y-3">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c.id)}
              className="w-full rounded-2xl border border-line bg-card2 py-4 text-[17px] font-semibold transition-fast active:scale-[0.98] active:border-accent"
            >
              {c.native}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
