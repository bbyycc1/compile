'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '@/lib/i18n/provider';
import { useKeyboardOpen } from './useKeyboard';

const TABS = [
  { href: '/', key: 'tabs.capture' as const },
  { href: '/people', key: 'tabs.people' as const },
  { href: '/rehearse', key: 'tabs.rehearse' as const },
  { href: '/followups', key: 'tabs.followups' as const },
];

export default function TabBar() {
  const pathname = usePathname();
  const { t } = useLang();
  const kbOpen = useKeyboardOpen();
  if (kbOpen) return null; // keyboard open: get out of the way
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-ink/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-xl mx-auto flex">
        {TABS.map((tab) => {
          const active =
            tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 py-2.5 text-center text-[13px] font-medium transition-fast ${
                active ? 'text-accent' : 'text-faint active:text-muted'
              }`}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
