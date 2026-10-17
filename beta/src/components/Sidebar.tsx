'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '@/lib/i18n/provider';

const TABS = [
  { href: '/', key: 'tabs.capture' as const },
  { href: '/people', key: 'tabs.people' as const },
  { href: '/rehearse', key: 'tabs.rehearse' as const },
  { href: '/followups', key: 'tabs.followups' as const },
];

/** Persistent left sidebar on desktop (lg+). The bottom TabBar serves mobile. */
export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLang();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-line bg-ink2 min-h-dvh sticky top-0 h-dvh px-4 py-8">
      <p className="px-2 text-[13px] font-bold tracking-tight text-cream">{t('appName')}</p>
      <nav className="mt-8 flex flex-col gap-1">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-xl px-3 py-2.5 text-[15px] font-medium transition-fast ${
                active ? 'bg-card2 text-accent' : 'text-muted hover:text-cream hover:bg-card'
              }`}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <Link
          href="/settings"
          className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-fast ${
            pathname === '/settings' ? 'bg-card2 text-accent' : 'text-muted hover:text-cream hover:bg-card'
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {t('settings.title')}
        </Link>
      </div>
    </aside>
  );
}
