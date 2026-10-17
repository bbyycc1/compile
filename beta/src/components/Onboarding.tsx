'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n/provider';

const WELCOME_KEY = 'nr-welcome-seen';
const INSTALL_KEY = 'nr-install-seen';

function isPhone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches &&
      Math.min(window.screen.width, window.screen.height) < 820
    );
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {}
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * First-run onboarding on the Capture page:
 * - phone users who haven't installed: "add to home screen" steps
 * - everyone: 3 quick tips. Both dismissible, shown once.
 */
export default function Onboarding() {
  const { t } = useLang();
  const [showWelcome, setShowWelcome] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [ios, setIos] = useState(true);

  useEffect(() => {
    try {
      if (!localStorage.getItem(WELCOME_KEY)) setShowWelcome(true);
      if (isPhone() && !isStandalone() && !localStorage.getItem(INSTALL_KEY)) {
        setShowInstall(true);
        setIos(isIOS());
      }
    } catch {}
  }, []);

  const dismissWelcome = () => {
    setShowWelcome(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {}
  };
  const dismissInstall = () => {
    setShowInstall(false);
    try {
      localStorage.setItem(INSTALL_KEY, '1');
    } catch {}
  };

  if (!showWelcome && !showInstall) return null;

  return (
    <div className="mb-4 space-y-3">
      {showInstall && (
        <div className="rounded-2xl bg-accent-dim border border-accent/30 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[14px] font-semibold text-ink">{t('onboarding.installTitle')}</p>
              <p className="mt-1 text-[13px] text-muted leading-5">
                {ios ? t('onboarding.installIOS') : t('onboarding.installAndroid')}
              </p>
            </div>
            <button
              onClick={dismissInstall}
              className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-accent active:scale-95 transition-fast"
            >
              {t('onboarding.notNow')}
            </button>
          </div>
        </div>
      )}
      {showWelcome && (
        <div className="rounded-2xl bg-card2 border border-line px-4 py-4">
          <p className="text-[16px] font-bold text-ink">{t('onboarding.welcomeTitle')}</p>
          <ul className="mt-3 space-y-2.5">
            <li className="flex gap-2.5">
              <span className="text-accent font-semibold">1.</span>
              <p className="text-[13px] text-muted leading-5">{t('onboarding.tip1')}</p>
            </li>
            <li className="flex gap-2.5">
              <span className="text-accent font-semibold">2.</span>
              <p className="text-[13px] text-muted leading-5">{t('onboarding.tip2')}</p>
            </li>
            <li className="flex gap-2.5">
              <span className="text-accent font-semibold">3.</span>
              <p className="text-[13px] text-muted leading-5">{t('onboarding.tip3')}</p>
            </li>
          </ul>
          <button
            onClick={dismissWelcome}
            className="mt-4 w-full rounded-2xl bg-accent py-2.5 text-[14px] font-semibold text-white active:scale-[0.98] transition-fast"
          >
            {t('onboarding.getStarted')}
          </button>
        </div>
      )}
    </div>
  );
}
