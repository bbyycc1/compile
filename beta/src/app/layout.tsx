import type { Metadata, Viewport } from 'next';
import { getSessionUser } from '@/lib/auth';
import { getLang } from '@/lib/i18n/server';
import { LangProvider } from '@/lib/i18n/provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Name-Remembering Event App',
  description: 'Never forget a name again.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f5f0',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const lang = await getLang(user?.language);
  return (
    <html lang={lang}>
      <body>
        <LangProvider initial={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
