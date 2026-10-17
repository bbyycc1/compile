'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Dict, Lang, getDict, normalizeLang } from './dict';

export type TFunction = (path: string, vars?: Record<string, string | number>) => string;

function resolvePath(dict: Dict, path: string): string {
  const v = path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      dict,
    );
  return typeof v === 'string' ? v : path;
}

function makeT(lang: Lang): TFunction {
  const dict = getDict(lang);
  return (path, vars) => {
    let s = resolvePath(dict, path);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  };
}

type LangCtx = {
  lang: Lang;
  t: TFunction;
  setLang: (l: Lang) => void;
};

const fallbackT = makeT('en');
const Ctx = createContext<LangCtx>({ lang: 'en', t: fallbackT, setLang: () => {} });

function readCookie(): Lang | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/);
  return m ? normalizeLang(decodeURIComponent(m[1])) : null;
}

export function LangProvider({
  initial,
  children,
}: {
  initial: Lang;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(() => readCookie() ?? initial);

  useEffect(() => {
    document.cookie = `lang=${lang}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    // persist server-side (best effort; ignored when logged out)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: l }),
    }).catch(() => {});
  }, []);

  const value = useMemo(() => ({ lang, t: makeT(lang), setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  return useContext(Ctx);
}
