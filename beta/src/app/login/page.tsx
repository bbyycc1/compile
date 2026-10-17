'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n/provider';
import LangPicker from '@/components/LangPicker';
import LangGate from '@/components/LangGate';

export default function LoginPage() {
  const { t } = useLang();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errText = (code: string) => {
    const map: Record<string, string> = {
      fill_all: 'auth.fillAll', bad_email: 'auth.badEmail', password_short: 'auth.passwordShort',
      email_taken: 'auth.emailTaken', bad_credentials: 'auth.badCredentials',
    };
    return t(map[code] ?? 'auth.error');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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

  const continueAsGuest = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      if (!res.ok) {
        setError(t('auth.error'));
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
        <h1 className="text-[28px] font-bold tracking-tight">{t('auth.welcome')}</h1>
        <div className="mt-6 space-y-3">
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
            placeholder={t('auth.password')}
            autoComplete="current-password"
            className="w-full rounded-2xl bg-card2 border border-line px-4 py-3 text-[15px] outline-none focus:border-accent placeholder:text-faint"
          />
        </div>
        {error && <p className="mt-3 text-[13px] text-accent">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-accent py-3.5 text-[16px] font-semibold text-ink transition-fast active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? '…' : t('auth.signIn')}
        </button>
        <button
          type="button"
          onClick={continueAsGuest}
          disabled={busy}
          className="mt-3 w-full rounded-2xl border border-line py-3.5 text-[16px] font-medium text-muted transition-fast active:scale-[0.98] disabled:opacity-50"
        >
          {t('auth.continueAsGuest')}
        </button>
        <p className="mt-4 text-center text-[14px] text-muted">
          <Link href="/signup" className="text-accent font-medium">
            {t('auth.noAccount')}
          </Link>
        </p>
        <LangPicker />
      </form>
    </div>
    </LangGate>
  );
}
