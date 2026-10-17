'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useLang } from '@/lib/i18n/provider';
import { LANGS, type Lang } from '@/lib/i18n/dict';

type GlossaryRow = { id: string; alias: string; canonical: string; kind: string };
type UsageSummary = {
  totalCost: number;
  totalCalls: number;
  last30dCost: number;
  byFeature: { feature: string; cost: number; calls: number }[];
};

/** Collapsible settings section: one compact row until tapped. */
function Section({
  title,
  hint,
  defaultOpen,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="mt-3 overflow-hidden rounded-2xl bg-card border border-line">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3.5 active:bg-card2 transition-fast"
      >
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-[15px] font-semibold truncate">{title}</span>
          {hint && !open && <span className="block text-[12px] text-faint truncate mt-0.5">{hint}</span>}
        </span>
        <span className={`text-faint text-[16px] leading-none transition-fast ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && <div className="border-t border-line/60 px-4 py-4">{children}</div>}
    </section>
  );
}

export default function SettingsPage() {
  const { t, lang, setLang } = useLang();
  const router = useRouter();
  const [glossary, setGlossary] = useState<GlossaryRow[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState(false);
  const [aboutMe, setAboutMe] = useState('');
  const [facts, setFacts] = useState<{ fact: string; learnedAt: string }[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const loadProfile = useCallback(async () => {
    const res = await fetch('/api/profile');
    if (res.ok) {
      const data = await res.json();
      setAboutMe(data.aboutMe ?? '');
      setFacts(data.facts ?? []);
    }
  }, []);

  const load = useCallback(async () => {
    const res = await fetch('/api/glossary');
    if (res.ok) {
      const data = await res.json();
      setGlossary(data.glossary);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => setIsGuest(!!d?.user?.isGuest))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUsage(d))
      .catch(() => {});
  }, []);

  const saveAboutMe = async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aboutMe }),
      });
      if (res.ok) setProfileMsg(t('settings.profileSaved'));
    } finally {
      setSavingProfile(false);
    }
  };

  const deleteFact = async (index: number) => {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteFactIndex: index }),
    });
    if (res.ok) {
      const data = await res.json();
      setFacts(data.facts ?? []);
    }
  };

  const changeLang = (l: Lang) => {
    setLang(l); // provider persists to cookie + server (best effort)
  };

  const cleanup = async () => {
    setCleaning(true);
    setCleanMsg(null);
    try {
      const res = await fetch('/api/maintenance/cleanup', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        const parts: string[] = [];
        if (data.mergedPeople) parts.push(t('settings.mergedPeople', { count: data.mergedPeople }));
        if (data.mergedTags) parts.push(t('settings.mergedTags', { count: data.mergedTags }));
        if (data.mergedOccasions) parts.push(t('settings.mergedOccasions', { count: data.mergedOccasions }));
        if (data.prunedTags) parts.push(t('settings.prunedTags', { count: data.prunedTags }));
        if (data.correctionsLearned) parts.push(t('settings.learnedCorrections', { count: data.correctionsLearned }));
        setCleanMsg(parts.length ? parts.join(' · ') : t('people.cleaned'));
        await load();
      }
    } finally {
      setCleaning(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/session', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  const recoverGuests = async () => {
    setRecovering(true);
    setRecoverMsg(null);
    try {
      const res = await fetch('/api/auth/recover-guests', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const n = (data.mergedPeople || []).length;
        setRecoverMsg(
          n > 0 ? t('settings.recoverGuestsDone', { count: n }) : t('settings.recoverGuestsNone'),
        );
      }
    } finally {
      setRecovering(false);
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    setImportErr(false);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('import_failed');
      const c = data.imported as Record<string, number>;
      const labels: [string, string][] = [
        ['people', 'settings.impPeople'],
        ['occasions', 'settings.impOccasions'],
        ['encounters', 'settings.impEncounters'],
        ['followUps', 'settings.impFollowUps'],
        ['backgroundBriefs', 'settings.impBriefs'],
        ['tags', 'settings.impTags'],
        ['glossary', 'settings.impGlossary'],
        ['relationshipSuggestions', 'settings.impSuggestions'],
      ];
      const parts = labels
        .filter(([k]) => (c[k] ?? 0) > 0)
        .map(([k, lk]) => `${c[k]} ${t(lk)}`);
      const lines = [t('settings.importDone') + (parts.length ? ': ' + parts.join(' · ') : '')];
      if (data.skipped && data.skipped.length) {
        lines.push(t('settings.importSkipped', { names: (data.skipped as string[]).join(', ') }));
      }
      setImportMsg(lines.join('\n'));
    } catch {
      setImportErr(true);
      setImportMsg(t('settings.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const featureLabel = (f: string) => {
    const key = `settings.feat${f.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase())}`;
    const label = t(key);
    return label === key ? f.replace(/_/g, ' ') : label;
  };

  return (
    <div className="px-4 pt-8 pb-4 lg:max-w-5xl w-full">
      <h1 className="text-[26px] font-bold tracking-tight">{t('settings.title')}</h1>

      {/* about you — the one section worth keeping open */}
      <Section title={t('settings.aboutYou')} hint={t('settings.aboutYouHint')} defaultOpen>
        <textarea
          value={aboutMe}
          onChange={(e) => setAboutMe(e.target.value)}
          placeholder={t('settings.aboutYouPlaceholder')}
          rows={3}
          className="w-full rounded-2xl bg-card2 border border-line px-4 py-2.5 text-[15px] outline-none focus:border-accent placeholder:text-faint resize-y"
        />
        <button
          onClick={() => void saveAboutMe()}
          disabled={savingProfile}
          className="mt-2 w-full rounded-2xl bg-accent py-3 text-[14px] font-semibold text-ink active:scale-[0.98] transition-fast disabled:opacity-50"
        >
          {savingProfile ? '…' : t('common.save')}
        </button>
        {profileMsg && <p className="mt-2 text-[13px] text-muted fade-up">{profileMsg}</p>}

        {facts.length > 0 && (
          <>
            <p className="mt-4 mb-2 text-[13px] font-medium text-muted">{t('settings.learnedTitle')}</p>
            <div className="space-y-2">
              {facts.map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded-2xl bg-card2 border border-line px-4 py-2.5">
                  <p className="flex-1 min-w-0 text-[14px]">{f.fact}</p>
                  <button
                    onClick={() => void deleteFact(i)}
                    aria-label={t('settings.removeFact')}
                    className="text-[18px] leading-none text-faint active:text-accent transition-fast shrink-0 px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* API usage */}
      <Section
        title={t('settings.usageTitle')}
        hint={usage ? `$${usage.totalCost.toFixed(2)} ${t('settings.usageTotalHint')}` : undefined}
        defaultOpen
      >
        {!usage ? (
          <p className="text-[13px] text-faint">{t('settings.usageEmpty')}</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold tracking-tight">${usage.totalCost.toFixed(2)}</span>
              <span className="text-[13px] text-faint">
                {t('settings.usageCalls', { count: usage.totalCalls })}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-faint">
              {t('settings.usageLast30', { amount: usage.last30dCost.toFixed(2) })}
            </p>
            {usage.byFeature.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {usage.byFeature.slice(0, 6).map((f) => (
                  <div key={f.feature} className="flex items-center justify-between text-[13px]">
                    <span className="text-muted">{featureLabel(f.feature)}</span>
                    <span className="text-faint tabular-nums">${f.cost.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[12px] text-faint">{t('settings.usageEstimated')}</p>
          </>
        )}
      </Section>

      {/* word corrections */}
      <Section
        title={t('settings.glossary')}
        hint={glossary.length ? t('settings.glossaryHint', { count: glossary.length }) : t('settings.noGlossary')}
      >
        {glossary.length === 0 ? (
          <p className="text-[13px] text-faint">{t('settings.noGlossary')}</p>
        ) : (
          <div className="space-y-2">
            {glossary.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-2xl bg-card2 border border-line px-4 py-2.5">
                <div className="flex-1 min-w-0 text-[14px]">
                  <span className="text-faint line-through decoration-faint/60">{g.alias}</span>
                  <span className="mx-2 text-faint">→</span>
                  <span className="font-medium">{g.canonical}</span>
                </div>
                <button
                  onClick={async () => {
                    await fetch(`/api/glossary/${g.id}`, { method: 'DELETE' });
                    await load();
                  }}
                  className="text-[13px] text-faint active:text-accent transition-fast shrink-0"
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* maintenance + data, together */}
      <Section title={t('settings.dataTitle')}>
        <button
          onClick={() => void cleanup()}
          disabled={cleaning}
          className="w-full rounded-2xl bg-card2 border border-line py-3 text-[14px] font-medium active:scale-[0.98] transition-fast disabled:opacity-50"
        >
          {cleaning ? '…' : t('settings.cleanup')}
        </button>
        {cleanMsg && <p className="mt-2 text-[13px] text-muted fade-up">{cleanMsg}</p>}

        <a
          href="/api/export"
          className="mt-3 block w-full rounded-2xl bg-card2 border border-line py-3 text-[14px] font-medium text-center active:scale-[0.98] transition-fast"
        >
          {t('settings.export')}
        </a>

        <p className="mt-4 mb-2 text-[13px] text-faint">{t('settings.importHint')}</p>
        <label className="block w-full rounded-2xl bg-card2 border border-line py-3 text-[14px] font-medium text-center active:scale-[0.98] transition-fast cursor-pointer">
          {importing ? t('settings.importing') : t('settings.importChoose')}
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </label>
        {importMsg && (
          <p className={`mt-2 text-[13px] whitespace-pre-line fade-up ${importErr ? 'text-accent' : 'text-muted'}`}>
            {importMsg}
          </p>
        )}

        {!isGuest && (
          <>
            <p className="mt-4 mb-2 text-[13px] text-faint">{t('settings.recoverGuestsSub')}</p>
            <button
              onClick={() => void recoverGuests()}
              disabled={recovering}
              className="w-full rounded-2xl bg-card2 border border-line py-3 text-[14px] font-medium active:scale-[0.98] transition-fast disabled:opacity-50"
            >
              {recovering ? '…' : t('settings.recoverGuests')}
            </button>
            {recoverMsg && <p className="mt-2 text-[13px] text-muted fade-up">{recoverMsg}</p>}
          </>
        )}
      </Section>

      {/* language */}
      <Section title={t('settings.language')} hint={LANGS.find((l) => l.id === lang)?.label}>
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button
              key={l.id}
              onClick={() => changeLang(l.id)}
              className={`flex-1 rounded-2xl border py-3 text-[14px] font-medium transition-fast active:scale-[0.98] ${
                lang === l.id
                  ? 'bg-accent text-ink border-accent font-semibold'
                  : 'bg-card2 border-line text-muted'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Section>

      {/* logout */}
      <button
        onClick={() => setConfirmLogout(true)}
        className="mt-3 w-full rounded-2xl bg-accent-dim py-3.5 text-[14px] font-semibold text-accent active:scale-[0.98] transition-fast"
      >
        {t('auth.logOut')}
      </button>

      {confirmLogout && (
        <ConfirmDialog
          title={t('auth.logOut')}
          message={t('settings.logoutConfirm')}
          confirmLabel={t('auth.logOut')}
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => void logout()}
        />
      )}
    </div>
  );
}
