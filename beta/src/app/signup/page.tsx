'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n/provider';
import LangPicker from '@/components/LangPicker';
import LangGate from '@/components/LangGate';

export default function SignupPage() {
  const { t } = useLang();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // If the visitor is already signed in as a guest, sign-up converts the guest
  // account (keeping all their data) instead of creating a new one.
  const [isGuestConvert, setIsGuestConvert] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => setIsGuestConvert(!!d?.user?.isGuest))
      .catch(() => {});
  }, []);
  const errText = (code: string) => {
    const map: Record<string, string> = {
      fill_all: 'auth.fillAll', bad_email: 'auth.badEmail', password_short: 'auth.passwordShort',
      email_taken: 'auth.emailTaken', bad_credentials: 'auth.badCredentials',
      not_guest: 'auth.notGuest',
    };
    return t(map[code] ?? 'auth.error');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(isGuestConvert ? '/api/auth/convert' : '/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errText(data.error ?? 'auth.error'));
      } else {
        router.replace('/');
        router.refresh();
      }
    } catch {
      setError(t('auth.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LangGate>
    <div className="min-h-dvh flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm fade-up">
        <h1 className="text-[28px] font-bold tracking-tight">
          {isGuestConvert ? t('auth.convertTitle') : t('auth.createAccount')}
        </h1>
        <div className="mt-6 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('auth.nameOptional')}
            autoComplete="name"
            className="w-full rounded-2xl bg-card2 border border-line px-4 py-3 text-[15px] outline-none focus:border-accent placeholder:text-faint"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.email')}
            autoComplete="email"
            className="w-full rounded-2xl bg-card2 border border-line px-4 py-3 text-[15px] outline-none focus:border-accent placeholder:text-faint"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`${t('auth.password')} (8+)`}
            autoComplete="new-password"
            className="w-full rounded-2xl bg-card2 border border-line px-4 py-3 text-[15px] outline-none focus:border-accent placeholder:text-faint"
          />
        </div>
        {error && <p className="mt-3 text-[13px] text-accent">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-accent py-3.5 text-[16px] font-semibold text-ink transition-fast active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? '…' : t('auth.signUp')}
        </button>
        <p className="mt-4 text-center text-[14px] text-muted">
          <Link href="/login" className="text-accent font-medium">
            {t('auth.haveAccount')}
          </Link>
        </p>
        <LangPicker />
      </form>
    </div>
    </LangGate>
  );
}
