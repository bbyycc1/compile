'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar, { PALETTE } from '@/components/Avatar';
import AvatarEditor from '@/components/AvatarEditor';
import type { AvatarSpec } from '@/components/AvatarFigure';
import InlineField from '@/components/InlineField';
import FollowUpItem, { type FollowUp } from '@/components/FollowUpItem';
import ConfirmDialog from '@/components/ConfirmDialog';
import { requestUndoDelete } from '@/components/UndoToast';
import { useLang } from '@/lib/i18n/provider';

type Profile = {
  id: string;
  name: string;
  headline: string | null;
  summary: string | null;
  company: string | null;
  roleTitle: string | null;
  industry: string | null;
  introHook: string | null;
  mutualConnections: string | null;
  likelyToMeetAgain: string | null;
  theyHelpMeWith: string | null;
  iOfferThem: string | null;
  appearance: string | null;
  avatarPhoto: string | null;
  avatarColor: string | null;
  avatarSpec: AvatarSpec | null;
  tags: { id: string; name: string; color: string | null }[];
  encounters: { id: string; summary: string | null; originalNote: string; occasionName: string | null; createdAt: string }[];
  followUps: FollowUp[];
};

type Brief = {
  roleLine: string | null;
  prevRoles: string | null;
  education: string | null;
  notableFact: string | null;
  sources: { title: string; url: string }[];
  confidence: string;
};

type Suggestion = { id: string; personId: string; personName: string | null; message: string };

const FIELDS: { key: string; label: string; multiline?: boolean }[] = [
  { key: 'summary', label: 'profile.fields.summary', multiline: true },
  { key: 'company', label: 'profile.fields.company' },
  { key: 'roleTitle', label: 'profile.fields.role' },
  { key: 'industry', label: 'profile.fields.industry' },
  { key: 'introHook', label: 'profile.fields.introHook' },
  { key: 'mutualConnections', label: 'profile.fields.mutual', multiline: true },
  { key: 'likelyToMeetAgain', label: 'profile.fields.meetAgain' },
  { key: 'theyHelpMeWith', label: 'profile.fields.theyHelp', multiline: true },
  { key: 'iOfferThem', label: 'profile.fields.iOffer', multiline: true },
  { key: 'appearance', label: 'profile.fields.appearance', multiline: true },
] as const;

function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Full profile view — used by the profile page and the desktop master-detail pane. */
export default function ProfileView({
  personId,
  onDeleted,
  backHref,
}: {
  personId: string;
  onDeleted?: () => void;
  backHref?: string;
}) {
  const router = useRouter();
  const { t } = useLang();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [lookingUp, setLookingUp] = useState<{ brief: boolean; photo: boolean }>({ brief: false, photo: false });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuColors, setMenuColors] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<{ id: string; name: string; color: string | null } | null>(null);
  const [newTag, setNewTag] = useState('');
  const [addingField, setAddingField] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [newFu, setNewFu] = useState('');
  const [newFuDue, setNewFuDue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNotice, setPhotoNotice] = useState(false);
  const [researchNotice, setResearchNotice] = useState(false);
  const [prevPhotos, setPrevPhotos] = useState<{ id: string; photoUrl: string }[]>([]);
  const takeRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCount = useRef(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/people/${personId}`);
    if (res.ok) {
      const data = await res.json();
      setProfile(data.person);
    } else if (res.status === 404) {
      if (onDeleted) onDeleted();
      else router.replace('/people');
    }
  }, [personId, router, onDeleted]);

  const loadResearch = useCallback(async () => {
    const res = await fetch(`/api/people/${personId}/research`);
    if (res.ok) {
      const data = await res.json();
      setBrief(data.brief);
      setLookingUp(data.lookingUp ?? { brief: false, photo: false });
    }
  }, [personId]);

  const loadPrevPhotos = useCallback(async () => {
    const res = await fetch(`/api/people/${personId}/photo`);
    if (res.ok) {
      const data = await res.json();
      setPrevPhotos(data.previous ?? []);
    }
  }, [personId]);

  const loadSuggestions = useCallback(async () => {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      const data = await res.json();
      setSuggestions((data.suggestions ?? []).filter((s: Suggestion) => s.personId === personId));
    }
  }, [personId]);

  useEffect(() => {
    setProfile(null);
    setBrief(null);
    setSuggestions([]);
    setPhotoNotice(false);
    setResearchNotice(false);
    setPrevPhotos([]);
    void load();
    void loadResearch();
    void loadSuggestions();
    void loadPrevPhotos();
  }, [load, loadResearch, loadSuggestions, loadPrevPhotos, personId]);

  // poll while research runs; reload the photo when it lands
  useEffect(() => {
    if (!lookingUp.brief && !lookingUp.photo) return;
    const id = setInterval(() => {
      void (async () => {
        const res = await fetch(`/api/people/${personId}/research`);
        if (!res.ok) return;
        const data = await res.json();
        const lu = data.lookingUp ?? { brief: false, photo: false };
        const wasPhoto = lookingUp.photo;
        const wasBrief = lookingUp.brief;
        const fromResearch = wasBrief; // brief job only runs via the Research button
        setBrief(data.brief);
        setLookingUp(lu);
        if (wasPhoto && !lu.photo) {
          if (!fromResearch && (data.photoOutcome === 'no_photo' || data.photoOutcome === 'failed')) {
            // "find another photo" came up empty — dismissible notice
            setPhotoNotice(true);
          } else {
            void load();
            void loadPrevPhotos();
          }
        }
        if (wasBrief && !lu.brief && !data.brief) {
          // Research finished without a confident match — dismissible notice
          setResearchNotice(true);
        }
      })();
    }, 4000);
    return () => clearInterval(id);
  }, [lookingUp, personId, load, loadPrevPhotos]);

  const patch = async (body: Record<string, string | null>) => {
    const res = await fetch(`/api/people/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setProfile(data.person);
    }
  };

  const setAvatar = async (body: { photo?: string | null; color?: string | null; remove?: boolean; spec?: AvatarSpec | null }) => {
    await fetch(`/api/people/${personId}/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setMenuOpen(false);
    setMenuColors(false);
    setAvatarEditorOpen(false);
    await load();
    await loadPrevPhotos();
  };

  const anotherPhoto = async () => {
    setMenuOpen(false);
    setPhotoNotice(false);
    setPhotoBusy(true);
    try {
      const res = await fetch(`/api/people/${personId}/photo`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await load();
        await loadPrevPhotos();
      } else if (data.status === 'looking') {
        setLookingUp((l) => ({ ...l, photo: true }));
      } else {
        // lookup finished immediately with nothing found
        setPhotoNotice(true);
      }
    } finally {
      setPhotoBusy(false);
    }
  };

  const revertPhoto = async (candidateId?: string) => {
    setMenuOpen(false);
    const res = await fetch(`/api/people/${personId}/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revertTo: candidateId ?? null }),
    });
    const data = await res.json();
    if (data.ok) {
      await load();
      await loadPrevPhotos();
    }
  };

  const runResearch = async () => {
    setResearchNotice(false);
    setPhotoNotice(false);
    await fetch(`/api/people/${personId}/research`, { method: 'POST' });
    setLookingUp((l) => ({ ...l, brief: true, photo: true }));
  };

  const onFile = async (f: File | undefined | null) => {
    if (!f || (f.type !== '' && !f.type.startsWith('image/'))) return;
    try {
      const photo = await resizePhoto(f);
      await setAvatar({ photo });
    } catch {
      /* ignore bad files */
    }
  };

  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  useEffect(() => {
    if (!menuOpen) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            void onFileRef.current(f);
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [menuOpen]);

  const addTag = async () => {
    const name = newTag.trim();
    if (!name || !profile) return;
    setNewTag('');
    const res = await fetch('/api/tags/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, personId }),
    });
    if (res.ok) await load();
  };

  const saveTag = async () => {
    if (!editingTag) return;
    const name = editingTag.name.trim();
    if (!name) return;
    await fetch(`/api/tags/${editingTag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: editingTag.color }),
    });
    setEditingTag(null);
    await load();
  };

  const deleteTag = async () => {
    if (!editingTag) return;
    await fetch(`/api/tags/${editingTag.id}`, { method: 'DELETE' });
    setEditingTag(null);
    await load();
  };

  const addFollowUp = async () => {
    const text = newFu.trim();
    if (!text) return;
    await fetch('/api/followups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, personId, dueDate: newFuDue || null }),
    });
    setNewFu('');
    setNewFuDue('');
    await load();
  };

  const answerSuggestion = async (id: string, action: 'accept' | 'dismiss') => {
    await fetch(`/api/suggestions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setSuggestions((s) => s.filter((x) => x.id !== id));
    if (action === 'accept') void load();
  };

  if (!profile) {
    return (
      <div className="px-4 pt-8">
        <div className="animate-pulse space-y-4">
          <div className="w-20 h-20 rounded-full bg-card2" />
          <div className="h-7 w-2/3 rounded bg-card2" />
          <div className="h-4 w-1/2 rounded bg-card2" />
        </div>
      </div>
    );
  }

  const primaryTag = profile.tags[0];
  const visibleFields = FIELDS.filter((f) => {
    const v = profile[f.key as keyof Profile] as string | null;
    return (v && v.trim()) || revealed.includes(f.key);
  });
  const hiddenFields = FIELDS.filter((f) => {
    const v = profile[f.key as keyof Profile] as string | null;
    return (!v || !v.trim()) && !revealed.includes(f.key);
  });

  return (
    <div className="px-4 pt-6 pb-4">
      <div className="flex items-center justify-between">
        {backHref ? (
          <Link href={backHref} className="text-[15px] text-accent font-medium active:scale-95 transition-fast">
            ‹ {t('common.back')}
          </Link>
        ) : (
          <span />
        )}
        <button
          onClick={() => setConfirmDelete(true)}
          className="text-[13px] text-faint active:text-accent transition-fast"
        >
          {t('common.delete')}
        </button>
      </div>

      {/* header */}
      <div className="mt-4 flex items-start gap-4">
        <div
          className="relative"
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            dragCount.current += 1;
            setDragOver(true);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            dragCount.current = Math.max(0, dragCount.current - 1);
            if (dragCount.current === 0) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragCount.current = 0;
            setDragOver(false);
            const files = e.dataTransfer.files;
            for (let i = 0; i < files.length; i++) {
              void onFile(files[i]);
              return;
            }
          }}
        >
          <Avatar
            name={profile.name}
            photo={profile.avatarPhoto}
            color={profile.avatarColor || (primaryTag?.color ?? undefined)}
            spec={profile.avatarSpec}
            size={76}
            onClick={() => {
              setMenuOpen((v) => !v);
              void loadPrevPhotos();
            }}
            lookingUp={lookingUp.photo || photoBusy}
          />
          {dragOver && (
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-1.5 rounded-full border-[3px] border-dashed border-accent"
            />
          )}
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); setMenuColors(false); }} />
              <div className="bloom absolute z-50 top-[84px] left-0 w-56 rounded-2xl bg-card2 border border-line p-2 shadow-xl">
                <button onClick={() => takeRef.current?.click()} className="w-full text-left px-3 py-2.5 rounded-xl text-[14px] active:bg-card transition-fast">
                  {t('avatar.takePhoto')}
                </button>
                <button onClick={() => uploadRef.current?.click()} className="w-full text-left px-3 py-2.5 rounded-xl text-[14px] active:bg-card transition-fast">
                  {t('avatar.uploadPhoto')}
                </button>
                <button onClick={() => void anotherPhoto()} className="w-full text-left px-3 py-2.5 rounded-xl text-[14px] active:bg-card transition-fast">
                  {t('photo.another')}
                </button>
                {prevPhotos.length > 0 && (
                  <div className="px-3 py-2">
                    <p className="text-[12px] font-medium text-faint mb-2">{t('photo.previousPhotos')}</p>
                    <div className="flex gap-2">
                      {prevPhotos.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => void revertPhoto(p.id)}
                          className="w-12 h-12 rounded-full overflow-hidden border-2 border-line active:border-accent active:scale-95 transition-fast shrink-0"
                          aria-label={t('photo.revert')}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.photoUrl} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => setMenuColors((v) => !v)} className="w-full text-left px-3 py-2.5 rounded-xl text-[14px] active:bg-card transition-fast">
                  {t('avatar.chooseColor')}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setAvatarEditorOpen(true);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-[14px] active:bg-card transition-fast"
                >
                  {t('avatar.editFigure')}
                </button>
                {menuColors && (
                  <div className="px-3 py-2 flex gap-2 fade-up">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => void setAvatar({ color: c })}
                        className="w-8 h-8 rounded-full active:scale-90 transition-fast"
                        style={{ background: c }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                )}
                {profile.avatarPhoto && (
                  <button onClick={() => void setAvatar({ remove: true })} className="w-full text-left px-3 py-2.5 rounded-xl text-[14px] text-accent active:bg-card transition-fast">
                    {t('avatar.removePhoto')}
                  </button>
                )}
                <p className="px-3 pt-1 pb-2 text-[12px] leading-snug text-faint">
                  {t('avatar.pasteDropHint')}
                </p>
              </div>
            </>
          )}
          <input ref={takeRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          {avatarEditorOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setAvatarEditorOpen(false)} />
              <div className="bloom fixed z-50 left-4 right-4 bottom-4 max-h-[80vh] overflow-y-auto rounded-3xl bg-card border border-line p-4 shadow-xl lg:left-auto lg:right-8 lg:bottom-8 lg:w-96">
                <AvatarEditor
                  initial={profile.avatarSpec}
                  onSave={(spec) => setAvatar({ spec })}
                  onClose={() => setAvatarEditorOpen(false)}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <div className="text-[24px] font-bold tracking-tight leading-tight">
            <InlineField value={profile.name} onSave={(v) => { if (v) void patch({ name: v }); }} ariaLabel={t('profile.nameLabel')} />
          </div>
          <div className="mt-0.5 text-[15px] text-muted leading-snug">
            <InlineField value={profile.headline} onSave={(v) => patch({ headline: v })} ariaLabel={t('profile.headlineLabel')} />
          </div>
          {lookingUp.photo && (
            <p className="mt-1 text-[12px] text-faint">{t('photo.looking')}</p>
          )}
          <button
            onClick={() => void runResearch()}
            disabled={lookingUp.brief}
            className="mt-2 rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-muted active:scale-95 transition-fast disabled:opacity-60"
          >
            {lookingUp.brief ? t('brief.researching') : t('brief.research')}
          </button>
        </div>
      </div>

      {/* dismissible "no verified photo" notice */}
      {photoNotice && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] text-cream">{t('photo.notFoundAnother')}</p>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => {
                setPhotoNotice(false);
                setMenuOpen(true);
              }}
              className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-ink active:scale-95 transition-fast"
            >
              {t('photo.addManually')}
            </button>
            <button
              onClick={() => setPhotoNotice(false)}
              className="rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-muted active:scale-95 transition-fast"
            >
              {t('common.ok')}
            </button>
          </div>
        </div>
      )}

      {/* dismissible "research found little" notice */}
      {researchNotice && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] text-cream">{t('brief.notMuch')}</p>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => void runResearch()}
              className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-ink active:scale-95 transition-fast"
            >
              {t('brief.retry')}
            </button>
            <button
              onClick={() => setResearchNotice(false)}
              className="rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-muted active:scale-95 transition-fast"
            >
              {t('common.ok')}
            </button>
          </div>
        </div>
      )}

      {/* relationship suggestions — one-tap Yes / No */}
      {suggestions.map((s) => (
        <div key={s.id} className="mt-4 rounded-2xl bg-card2 border border-line px-4 py-3 fade-up">
          <p className="text-[14px] leading-relaxed">{s.message}</p>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => void answerSuggestion(s.id, 'accept')}
              className="rounded-full bg-accent px-5 py-1.5 text-[13px] font-semibold text-ink active:scale-95 transition-fast"
            >
              {t('common.yes')}
            </button>
            <button
              onClick={() => void answerSuggestion(s.id, 'dismiss')}
              className="rounded-full border border-line px-5 py-1.5 text-[13px] font-medium text-muted active:scale-95 transition-fast"
            >
              {t('common.no')}
            </button>
          </div>
        </div>
      ))}

      {/* background brief — clearly separated, never overwrites user notes */}
      <div className="mt-6">
        {brief && (
          <section className="rounded-2xl bg-card border border-line p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t('brief.title')}</p>
            {brief.roleLine && <p className="mt-2 text-[15px] font-medium leading-relaxed">{brief.roleLine}</p>}
            {brief.prevRoles && (
              <p className="mt-1.5 text-[14px] text-muted leading-relaxed whitespace-pre-line">{brief.prevRoles}</p>
            )}
            {brief.education && (
              <p className="mt-1.5 text-[14px] text-muted"><span className="text-faint">{t('brief.education')}: </span>{brief.education}</p>
            )}
            {brief.notableFact && (
              <p className="mt-1.5 text-[14px] text-muted"><span className="text-faint">{t('brief.notable')}: </span>{brief.notableFact}</p>
            )}
            {brief.sources.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {brief.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-accent underline underline-offset-2 decoration-accent/40"
                  >
                    {s.title || s.url}
                  </a>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* tags */}
      <div className="mt-4 relative">
        <div className="flex flex-wrap gap-2">
          {profile.tags.map((tag) => {
            const color = tag.color ?? '#8a8a93';
            return (
              <button
                key={tag.id}
                onClick={() => setEditingTag({ id: tag.id, name: tag.name, color: tag.color })}
                className="rounded-full px-3.5 py-1.5 text-[13px] font-medium active:scale-95 transition-fast"
                style={{ background: `${color}1a`, color, border: `1px solid ${color}44` }}
              >
                {tag.name}
              </button>
            );
          })}
          <div className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addTag()}
              placeholder={t('common.addTag')}
              className="w-20 bg-transparent outline-none text-[13px] placeholder:text-faint"
            />
            {newTag.trim() && (
              <button onClick={() => void addTag()} className="text-accent text-[13px] font-semibold">
                +
              </button>
            )}
          </div>
        </div>
        {editingTag && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setEditingTag(null)} />
            <div className="bloom absolute z-50 top-10 left-0 w-64 rounded-2xl bg-card2 border border-line p-4 shadow-xl">
              <input
                value={editingTag.name}
                onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                className="w-full rounded-xl bg-card border border-line px-3 py-2 text-[14px] outline-none focus:border-accent"
              />
              <div className="mt-3 flex gap-2">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setEditingTag({ ...editingTag, color: c })}
                    className={`w-7 h-7 rounded-full active:scale-90 transition-fast ${editingTag.color === c ? 'ring-2 ring-cream' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => void saveTag()} className="flex-1 rounded-xl bg-accent py-2 text-[14px] font-semibold text-ink active:scale-95 transition-fast">
                  {t('common.save')}
                </button>
                <button onClick={() => void deleteTag()} className="flex-1 rounded-xl bg-card border border-line py-2 text-[14px] text-accent font-medium active:scale-95 transition-fast">
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* details — empty fields stay hidden */}
      <div className="mt-6 space-y-4">
        {visibleFields.map((f) => (
          <section key={f.key}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t(f.label)}</p>
            <div className="mt-1 text-[15px] leading-relaxed">
              <InlineField
                value={profile[f.key as keyof Profile] as string | null}
                multiline={!!f.multiline}
                onSave={(v) => patch({ [f.key]: v })}
                ariaLabel={t(f.label)}
              />
            </div>
          </section>
        ))}
        {hiddenFields.length > 0 && (
          <div>
            {!addingField ? (
              <button onClick={() => setAddingField(true)} className="text-[13px] text-faint active:text-muted transition-fast">
                + {t('profile.addDetail')}
              </button>
            ) : (
              <div className="flex flex-wrap gap-2 fade-up">
                {hiddenFields.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => {
                      setRevealed((r) => [...r, f.key]);
                      setAddingField(false);
                    }}
                    className="rounded-full border border-line px-3 py-1.5 text-[13px] text-muted active:scale-95 transition-fast"
                  >
                    + {t(f.label)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* encounters — raw notes collapsed, summaries primary, no dates */}
      {profile.encounters.length > 0 && (
        <div className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t('profile.timeline')}</p>
          <div className="mt-2 space-y-3">
            {profile.encounters.map((e) => (
              <div key={e.id} className="rounded-2xl bg-card2 border border-line p-4">
                {e.occasionName && (
                  <p className="text-[12px] font-medium text-muted mb-1">{e.occasionName}</p>
                )}
                {e.summary && <p className="text-[14px] leading-relaxed">{e.summary}</p>}
                <details className="mt-2">
                  <summary className="text-[13px] text-faint cursor-pointer active:text-muted">
                    {t('profile.originalNote')}
                  </summary>
                  <p className="mt-1.5 text-[13px] text-muted leading-relaxed whitespace-pre-wrap">{e.originalNote}</p>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* follow-ups */}
      <div className="mt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t('tabs.followups')}</p>
        <div className="mt-1 divide-y divide-line/60">
          {profile.followUps.map((f) => (
            <FollowUpItem key={f.id} item={f} onChange={load} />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newFu}
            onChange={(e) => setNewFu(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addFollowUp()}
            placeholder={t('followups.addPlaceholder')}
            className="flex-1 rounded-2xl bg-card2 border border-line px-4 py-2.5 text-[14px] outline-none focus:border-accent placeholder:text-faint"
          />
          <input
            type="date"
            value={newFuDue}
            onChange={(e) => setNewFuDue(e.target.value)}
            className="w-[118px] rounded-2xl bg-card2 border border-line px-2 py-2.5 text-[13px] outline-none text-muted"
            style={{ colorScheme: 'dark' }}
            aria-label={t('followups.due')}
          />
          <button
            onClick={() => void addFollowUp()}
            disabled={!newFu.trim()}
            className="w-10 h-10 shrink-0 rounded-full bg-accent text-ink font-bold text-lg active:scale-90 transition-fast disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('people.deleteTitle')}
          message={t('people.deleteBody')}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            const res = await fetch(`/api/people/${personId}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            setConfirmDelete(false);
            if (data.snapshot) requestUndoDelete(data.snapshot);
            if (onDeleted) onDeleted();
            else router.replace('/people');
          }}
        />
      )}
    </div>
  );
}
