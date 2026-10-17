'use client';

import { useEffect, useRef, useState } from 'react';
import { LANGS, type Lang } from '@/lib/i18n/dict';

type Recog = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type Ctor = new () => Recog;

function getCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, Ctor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type ResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

/**
 * Voice input for iOS reliability.
 *
 * Strategy: chain single utterances. iOS handles single-utterance
 * recognition far better than continuous mode, but it stops on every pause.
 * So when an utterance ends and the user still wants to dictate, we start
 * the next one automatically — giving continuous dictation from reliable parts.
 *
 * - Tap mic: starts dictating (wantRef=true), utterances chain automatically.
 * - Tap mic again: stops everything, unconditionally.
 * - Text accumulates across utterances; interim results show live.
 * - A watchdog guarantees the UI never sticks in "listening".
 */
export function useSpeech(lang: Lang, onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recogRef = useRef<Recog | null>(null);
  const wantRef = useRef(false); // user wants to dictate
  const accumRef = useRef(''); // full dictated text this session (before current utterance)
  const genRef = useRef(0);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const langRef = useRef(lang);
  langRef.current = lang;

  const clearTimers = () => {
    if (restartTimer.current) {
      clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  /** Stop everything, reset UI. Safe to call any time. */
  const killAll = () => {
    wantRef.current = false;
    genRef.current++;
    clearTimers();
    const r = recogRef.current;
    recogRef.current = null;
    if (r) {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      try {
        r.abort();
      } catch {}
    }
    accumRef.current = '';
    setListening(false);
  };

  /** Start one utterance. On end, chains the next if the user still wants to dictate. */
  const startUtterance = () => {
    const C = getCtor();
    if (!C || !wantRef.current) return;
    const gen = ++genRef.current;
    let recog: Recog;
    try {
      recog = new C();
    } catch {
      // Retry once shortly after; iOS sometimes needs a beat between sessions.
      if (wantRef.current) {
        restartTimer.current = setTimeout(() => {
          if (wantRef.current && genRef.current === gen) startUtterance();
        }, 400);
      }
      return;
    }
    recogRef.current = recog;
    recog.lang = LANGS.find((l) => l.id === langRef.current)?.speech ?? 'en-US';
    recog.interimResults = true;
    recog.continuous = false;
    recog.maxAlternatives = 1;

    recog.onresult = (e: unknown) => {
      if (genRef.current !== gen || !wantRef.current) return;
      const ev = e as ResultEvent;
      let utteranceText = '';
      let hasFinal = false;
      for (let i = 0; i < ev.results.length; i++) {
        utteranceText += ev.results[i][0].transcript;
        if (ev.results[i].isFinal) hasFinal = true;
      }
      const base = accumRef.current ? accumRef.current.replace(/\s+$/, '') + ' ' : '';
      const full = base + utteranceText;
      onTextRef.current(full);
      if (hasFinal) {
        // Lock in this utterance's text; the next utterance appends after it.
        accumRef.current = full;
      }
    };
    recog.onerror = () => {
      // Utterance died (no-speech, network). Chain continues via onend.
    };
    recog.onend = () => {
      if (genRef.current !== gen) return;
      recogRef.current = null;
      if (!wantRef.current) {
        setListening(false);
        return;
      }
      // Chain the next utterance after a short beat (iOS needs it).
      clearTimers();
      restartTimer.current = setTimeout(() => {
        if (wantRef.current) startUtterance();
      }, 250);
    };
    try {
      recog.start();
    } catch {
      recogRef.current = null;
      if (wantRef.current) {
        restartTimer.current = setTimeout(() => {
          if (wantRef.current) startUtterance();
        }, 400);
      }
      return;
    }
    setListening(true);
    // Watchdog: never stick in "listening" with a dead recognizer.
    clearTimers();
    watchdogRef.current = setTimeout(() => {
      if (wantRef.current && genRef.current === gen && !recogRef.current) {
        startUtterance();
      }
    }, 30000);
  };

  useEffect(() => {
    setSupported(!!getCtor());
    const onHide = () => {
      if (document.visibilityState === 'hidden') killAll();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', killAll);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', killAll);
      killAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (currentText: string) => {
    if (wantRef.current || listening || recogRef.current) {
      // User wants out — unconditional.
      killAll();
      return;
    }
    if (!getCtor()) return;
    wantRef.current = true;
    accumRef.current = currentText;
    startUtterance();
  };

  return { listening, supported, toggle, stop: killAll };
}
