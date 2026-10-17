'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n/provider';

/**
 * Persistent banner for guest accounts. Dismissible per session (sessionStorage)
 * so it reappears on the next visit until the guest converts to a full account.
 */
export default function GuestBanner() {
  const { t } = useLang();
  const [dismissed, setDismissed] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem('guestBannerDismissed') === '1',
  );
  if (dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem('guestBannerDismissed', '1');
    } catch {}
    setDismissed(true);
  };

  return (
    <div className="mx-4 mt-2 flex items-center gap-1.5 rounded-full border border-line bg-card2 py-1.5 pl-4 pr-1.5 lg:mx-0">
      <p className="min-w-0 flex-1 truncate text-[12px] text-muted">{t('auth.guestBannerShort')}</p>
      <Link
        href="/login"
        className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold text-accent transition-fast active:scale-95"
      >
        {t('auth.signIn')}
      </Link>
      <Link
        href="/signup"
        className="shrink-0 rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-ink transition-fast active:scale-95"
      >
        {t('auth.signUp')}
      </Link>
      <button
        onClick={dismiss}
        aria-label={t('common.close')}
        className="shrink-0 rounded-full px-2 py-1 text-[14px] leading-none text-faint transition-fast active:scale-95"
      >
        ×
      </button>
    </div>
  );
}
