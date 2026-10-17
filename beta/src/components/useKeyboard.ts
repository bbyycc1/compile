'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks whether the on-screen keyboard is open, via input focus.
 * More reliable on iOS than visualViewport, which is buggy in standalone PWAs.
 */
let keyboardOpen = false;
const listeners = new Set<(v: boolean) => void>();

export function setKeyboardOpen(v: boolean) {
  if (keyboardOpen === v) return;
  keyboardOpen = v;
  listeners.forEach((l) => l(v));
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(keyboardOpen);
  useEffect(() => {
    listeners.add(setOpen);
    return () => {
      listeners.delete(setOpen);
    };
  }, []);
  return open;
}
