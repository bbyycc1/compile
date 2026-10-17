'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PersonRow from '@/components/PersonRow';
import TagBar, { type Tag } from '@/components/TagBar';
import ManualAddModal from '@/components/ManualAddModal';
import ProfileView from '@/components/ProfileView';
import { requestUndoDelete } from '@/components/UndoToast';
import { useLang } from '@/lib/i18n/provider';
import type { PersonCard } from '@/lib/people-queries';

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return desktop;
}

export default function PeoplePage() {
  const { t } = useLang();
  const desktop = useDesktop();
  const [people, setPeople] = useState<PersonCard[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [q, setQ] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (tagId) params.set('tag', tagId);
    const res = await fetch(`/api/people?${params}`);
    if (res.ok) {
      const data = await res.json();
      setPeople(data.people);
    }
    setLoaded(true);
  }, [q, tagId]);

  const loadTags = useCallback(async () => {
    const res = await fetch('/api/tags');
    if (res.ok) {
      const data = await res.json();
      setTags(data.tags);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/people/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (data.snapshot) requestUndoDelete(data.snapshot);
    if (selected === id) setSelected(null);
    await load();
    await loadTags();
  };

  // Refresh when a delete is undone from the global toast.
  useEffect(() => {
    const onChanged = () => { void load(); void loadTags(); };
    window.addEventListener('people-changed', onChanged);
    return () => window.removeEventListener('people-changed', onChanged);
  }, [load, loadTags]);

  const listPane = (
    <div className="min-w-0">
      <div className="flex items-start justify-between px-4 pt-8">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t('tabs.people')}</h1>
        </div>
      </div>

      <div className="mt-4 px-4 flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('people.searchPlaceholder')}
          className="flex-1 min-w-0 rounded-2xl bg-card2 border border-line px-4 py-2.5 text-[15px] outline-none focus:border-accent placeholder:text-faint"
        />
        <button
          onClick={() => setAdding(true)}
          aria-label={t('manualAdd.title')}
          className="w-11 h-11 shrink-0 rounded-full bg-accent text-ink font-bold text-xl flex items-center justify-center transition-fast active:scale-90"
        >
          +
        </button>
      </div>

      {tags.length > 0 && (
        <div className="mt-3 px-4">
          <TagBar tags={tags} activeId={tagId} onSelect={setTagId} />
        </div>
      )}

      <div className="mt-2 divide-y divide-line/60">
        {people.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            onDelete={remove}
            onSelect={desktop ? setSelected : undefined}
            selected={selected === p.id}
          />
        ))}
      </div>

      {loaded && people.length === 0 && (
        <p className="mt-10 text-center text-[14px] text-faint">{t('people.empty')}</p>
      )}
    </div>
  );

  return (
    <div className="pb-4">
      {/* mobile: plain list (rows navigate); desktop: list + profile side by side */}
      <div className="lg:hidden">{listPane}</div>
      <div className="hidden lg:flex items-start gap-6 px-6">
        <div className="w-[380px] shrink-0 border-r border-line min-h-dvh pr-4">{listPane}</div>
        <div className="flex-1 min-w-0 max-w-2xl">
          {selected ? (
            <ProfileView
              key={selected}
              personId={selected}
              onDeleted={() => {
                setSelected(null);
                void load();
              }}
            />
          ) : (
            <div className="pt-24 text-center">
              <p className="text-[14px] text-faint">{t('people.selectPerson')}</p>
            </div>
          )}
        </div>
      </div>
      {adding && (
        <ManualAddModal
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            setSelected(id);
            void load();
            void loadTags();
          }}
        />
      )}
    </div>
  );
}
