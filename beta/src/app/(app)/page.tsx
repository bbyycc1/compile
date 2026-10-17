'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Composer from '@/components/Composer';
import { useKeyboardOpen } from '@/components/useKeyboard';
import { requestUndoDelete } from '@/components/UndoToast';
import PersonRow from '@/components/PersonRow';
import Avatar from '@/components/Avatar';
import { useLang } from '@/lib/i18n/provider';
import type { PersonCard } from '@/lib/people-queries';
import type { CaptureResult, ConversationTurn } from '@/lib/organizer';
import type { PersonSnapshot } from '@/lib/person-snapshot';

type CommandResult =
  | { kind: 'update'; personId: string; personName: string; summary: string; changedFields: string[]; updates: Record<string, string | null>; ambiguousWith: { id: string; name: string }[] }
  | { kind: 'photo'; personId: string; personName: string; status: 'done' | 'looking' | 'none' }
  | { kind: 'photo_revert'; personId: string; personName: string; status: 'done' | 'none' }
  | { kind: 'name_guess'; contacts: { id: string; name: string; headline: string | null }[]; guesses: string[] }
  | { kind: 'event_research'; eventHint: string; status: string }
  | { kind: 'assistant'; response: string; changed: boolean; personNames: string[]; deletedSnapshot?: PersonSnapshot | null };

type ProspectEvent = {
  id: string;
  title: string;
  sourceUrl: string | null;
  filters: string | null;
  prospects: {
    id: string; name: string; headline: string | null; company: string | null;
    roleTitle: string | null; reason: string | null; photoUrl: string | null;
    status: string; personId: string | null;
  }[];
};

type Suggestion = { id: string; personId: string; personName: string | null; message: string };

const TURNS_KEY = 'convoTurns';

function readTurns(): ConversationTurn[] {
  try {
    const raw = sessionStorage.getItem(TURNS_KEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.slice(-6) : [];
  } catch {
    return [];
  }
}

export default function CapturePage() {
  const { t } = useLang();
  const kbOpen = useKeyboardOpen();
  const router = useRouter();
  const [people, setPeople] = useState<PersonCard[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<CaptureResult | null>(null);
  const [saveFlash, setSaveFlash] = useState(false); // "Saved ✓" shown the instant a note is kept
  const [pendingSave, setPendingSave] = useState<string | null>(null); // pendingId being polled
  const lastTextRef = useRef('');
  const [command, setCommand] = useState<CommandResult | null>(null);
  const [assistantChats, setAssistantChats] = useState<{ q: string; a: string }[]>([]);
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<PersonSnapshot | null>(null);
  const [events, setEvents] = useState<ProspectEvent[]>([]);
  const [researchingEvent, setResearchingEvent] = useState<string | null>(null);
  const [eventLinkNeeded, setEventLinkNeeded] = useState<string | null>(null);
  const [eventLink, setEventLink] = useState('');
  const [eventLinkBusy, setEventLinkBusy] = useState(false);
  const researchStartRef = useRef<number>(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [guessName, setGuessName] = useState<string | undefined>(undefined);
  const turnsRef = useRef<ConversationTurn[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/people');
    if (res.ok) {
      const data = await res.json();
      setPeople(data.people.slice(0, 12));
    }
  }, []);

  const remove = async (id: string) => {
    const res = await fetch(`/api/people/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (data.snapshot) requestUndoDelete(data.snapshot);
    await load();
  };

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/prospects');
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events ?? []);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    }
  }, []);

  useEffect(() => {
    turnsRef.current = readTurns();
    void load();
    void loadEvents();
    void loadSuggestions();
  }, [load, loadEvents, loadSuggestions]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 4500);
    return () => clearTimeout(id);
  }, [error]);

  // poll while an event is being researched; after ~75s without a card, ask for the link
  useEffect(() => {
    if (!researchingEvent) return;
    researchStartRef.current = Date.now();
    const id = setInterval(() => {
      void (async () => {
        const res = await fetch('/api/prospects');
        if (!res.ok) return;
        const data = await res.json();
        const evs: ProspectEvent[] = data.events ?? [];
        setEvents(evs);
        const hint = researchingEvent.toLowerCase();
        if (evs.some((e) => e.title.toLowerCase().includes(hint) || hint.includes(e.title.toLowerCase()))) {
          setResearchingEvent(null);
        } else if (Date.now() - researchStartRef.current > 75000) {
          setResearchingEvent(null);
          setEventLinkNeeded(researchingEvent);
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [researchingEvent]);

  // poll while a photo lookup runs from a command
  useEffect(() => {
    if (command?.kind !== 'photo' || command.status !== 'looking') return;
    const id = setInterval(() => {
      void (async () => {
        const res = await fetch(`/api/people/${command.personId}/research`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.lookingUp?.photo) {
          // finished — check whether a verified photo actually landed
          if (data.photoOutcome === 'no_photo' || data.photoOutcome === 'failed') {
            setCommand({ ...command, status: 'none' });
          } else {
            setCommand({ ...command, status: 'done' });
          }
          void load();
        }
      })();
    }, 4000);
    return () => clearInterval(id);
  }, [command, load]);

  const submitEventLink = async () => {
    const url = eventLink.trim();
    if (!url || !eventLinkNeeded || eventLinkBusy) return;
    setEventLinkBusy(true);
    try {
      const res = await fetch('/api/prospects/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventHint: eventLinkNeeded, sourceUrl: url }),
      });
      const data = await res.json();
      if (data.ok) {
        setEventLinkNeeded(null);
        setEventLink('');
        await loadEvents();
      }
    } finally {
      setEventLinkBusy(false);
    }
  };

  const pushTurn = (text: string, personNames: string[], assistantResponse?: string) => {
    const next = [...turnsRef.current, { text, personNames, assistantResponse }].slice(-6);
    turnsRef.current = next;
    try {
      sessionStorage.setItem(TURNS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  /** Restore a just-deleted person from its snapshot. */
  const doUndoDelete = async () => {
    if (!undoSnapshot) return;
    const snap = undoSnapshot;
    setUndoSnapshot(null);
    try {
      const res = await fetch('/api/people/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: snap }),
      });
      if (res.ok) {
        setAssistantChats((prev) => [...prev, { q: '', a: `Restored ${snap.person.name}.` }]);
        void load();
      }
    } catch {}
  };

  // Auto-dismiss the undo snapshot after 20s.
  useEffect(() => {
    if (!undoSnapshot) return;
    const id = setTimeout(() => setUndoSnapshot(null), 20000);
    return () => clearTimeout(id);
  }, [undoSnapshot]);

  // Refresh when a delete is undone from the global toast.
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener('people-changed', onChanged);
    return () => window.removeEventListener('people-changed', onChanged);
  }, [load]);

  const send = async (text: string) => {
    // "undo" right after a delete restores it — no need to bother the AI.
    if (/^(undo|undo that|reverse( that)?|bring (it|them|him|her) back)[.! ]*$/i.test(text.trim()) && undoSnapshot) {
      await doUndoDelete();
      return;
    }
    // Cancel any in-flight request before starting a new one.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setAssistantThinking(true);
    setError(null);
    setSaved(null);
    setSaveFlash(false);
    setCommand(null);
    setConfirmed(new Set());
    lastTextRef.current = text;
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, recentTurns: turnsRef.current }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === 'ai_unavailable'
            ? t('capture.aiDown')
            : data.error === 'no_person'
              ? t('capture.noPerson')
              : t('auth.error'),
        );
        return;
      }
      if (data.saved && data.pendingId) {
        // Optimistic capture: the note is kept. Show "Saved" instantly;
        // the organizer fills it in via background polling below.
        setSaveFlash(true);
        setPendingSave(data.pendingId);
        setBusy(false);
        setAssistantThinking(false);
        if (abortRef.current === ctrl) abortRef.current = null;
        return;
      }
      if (data.command) {
        const c: CommandResult = data.command;
        setCommand(c);
        if (c.kind === 'assistant') {
          setAssistantChats((prev) => [...prev, { q: text, a: c.response }]);
          pushTurn(text, c.personNames, c.response);
          if (c.changed) void load();
          if (c.deletedSnapshot) {
            setUndoSnapshot(c.deletedSnapshot);
            requestUndoDelete(c.deletedSnapshot);
          }
        } else if (c.kind === 'update') pushTurn(text, [c.personName]);
        else if (c.kind === 'photo') {
          pushTurn(text, [c.personName]);
          if (c.status === 'done') void load();
        } else if (c.kind === 'photo_revert') {
          pushTurn(text, [c.personName]);
          if (c.status === 'done') void load();
        } else if (c.kind === 'event_research') {
          setResearchingEvent(c.eventHint);
        }
        return;
      }
      const results: CaptureResult = data.results ?? [];
      if (results.length) {
        setSaved(results);
        pushTurn(text, results.map((r) => r.personName));
      }
      await load();
    } catch (err) {
      // User hit stop: stay quiet, keep her text (Composer restores it).
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(t('auth.error'));
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      setAssistantThinking(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  // Poll for the background organizer after an optimistic save.
  useEffect(() => {
    if (!pendingSave) return;
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 45; i++) {
        // up to ~90s
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled) return;
        try {
          const res = await fetch(`/api/capture/status?pendingId=${pendingSave}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.status === 'done') {
            if (cancelled) return;
            const results: CaptureResult = data.results ?? [];
            if (results.length) {
              setSaved(results);
              pushTurn(
                lastTextRef.current,
                results.map((r) => r.personName),
              );
            }
            setSaveFlash(false);
            setPendingSave(null);
            await load();
            return;
          }
          if (data.status === 'failed') {
            if (cancelled) return;
            setError(t('capture.aiDown'));
            setSaveFlash(false);
            setPendingSave(null);
            return;
          }
        } catch {
          // keep polling
        }
      }
      // Timed out: the note is safe; stop polling quietly.
      if (!cancelled) {
        setSaveFlash(false);
        setPendingSave(null);
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [pendingSave, t, load]);

  const convertProspect = async (prospectId: string) => {
    const res = await fetch(`/api/prospects/${prospectId}/convert`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      await loadEvents();
      router.push(`/people/${data.personId}`);
    }
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

  const uncertain = (saved ?? []).filter((r) => r.nameUncertain && !confirmed.has(r.personId));
  const confirmName = (personId: string) =>
    setConfirmed((prev) => new Set(prev).add(personId));

  return (
    <div className="px-4 pt-8 pb-4 min-h-[calc(100dvh-6rem)] lg:min-h-[calc(100dvh-2.5rem)] flex flex-col lg:max-w-3xl lg:mx-auto w-full">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
        {t('tabs.capture')}
      </p>
      <h1 className="mt-1 text-[26px] font-bold tracking-tight pr-14 lg:pr-0">{t('capture.heading')}</h1>

      {error && (
        <div className="mt-3 rounded-2xl px-4 py-3 text-[14px] fade-up bg-accent-dim text-accent">
          {error}
        </div>
      )}

      {saveFlash && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] font-semibold text-cream">✓ {t('capture.saved')}</p>
        </div>
      )}

      {/* command results */}
      {command?.kind === 'update' && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] font-semibold text-cream">
            {t('commands.updated')}: <Link href={`/people/${command.personId}`} className="text-accent">{command.personName}</Link>
          </p>
          <p className="mt-1 text-[14px] text-muted">{command.summary}</p>
          {command.ambiguousWith.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-faint">—</span>
              {command.ambiguousWith.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void (async () => {
                    const res = await fetch('/api/command-update', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ personId: c.id, updates: command.updates }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setCommand({ ...command, personId: data.personId, personName: data.personName, changedFields: data.changedFields, ambiguousWith: [] });
                      pushTurn(`update ${data.personName}`, [data.personName]);
                    }
                  })()}
                  className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-muted active:scale-95 transition-fast"
                >
                  {c.name}?
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {command?.kind === 'photo' && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          {command.status === 'done' ? (
            <p className="text-[14px] text-cream">
              {t('commands.photoDone')}: <Link href={`/people/${command.personId}`} className="text-accent font-semibold">{command.personName}</Link>
            </p>
          ) : command.status === 'none' ? (
            <div>
              <p className="text-[14px] text-cream">{t('photo.notFoundAnother')}</p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => router.push(`/people/${command.personId}`)}
                  className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-ink active:scale-95 transition-fast"
                >
                  {t('photo.addManually')}
                </button>
                <button
                  onClick={() => setCommand(null)}
                  className="rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-muted active:scale-95 transition-fast"
                >
                  {t('common.ok')}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[14px] text-cream">
              {t('commands.photoLooking')} <span className="text-muted">{command.personName}</span>
            </p>
          )}
        </div>
      )}
      {command?.kind === 'photo_revert' && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] text-cream">
            {command.status === 'done' ? (
              <>{t('commands.photoReverted')}: <Link href={`/people/${command.personId}`} className="text-accent font-semibold">{command.personName}</Link></>
            ) : (
              <>{t('commands.photoRevertNone')}</>
            )}
          </p>
          {command.status === 'none' && (
            <div className="mt-2">
              <button
                onClick={() => setCommand(null)}
                className="rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-muted active:scale-95 transition-fast"
              >
                {t('common.ok')}
              </button>
            </div>
          )}
        </div>
      )}
      {command?.kind === 'name_guess' && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] font-semibold text-cream">{t('commands.nameGuessTitle')}</p>
          {command.contacts.length > 0 && (
            <div className="mt-2">
              <p className="text-[12px] text-faint mb-1.5">{t('commands.fromContacts')}</p>
              <div className="flex flex-wrap gap-2">
                {command.contacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/people/${c.id}`)}
                    className="rounded-full bg-accent-dim border border-accent/30 px-3.5 py-1.5 text-[14px] text-cream active:scale-95 transition-fast"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {command.guesses.length > 0 && (
            <div className="mt-2">
              <p className="text-[12px] text-faint mb-1.5">{t('commands.guessesLabel')}</p>
              <div className="flex flex-wrap gap-2">
                {command.guesses.map((g) => (
                  <button
                    key={g}
                    onClick={() => {
                      pushTurn(`name guess: ${g}`, [g]);
                      setGuessName(g);
                      setCommand(null);
                    }}
                    className="rounded-full border border-line px-3.5 py-1.5 text-[14px] text-muted active:scale-95 transition-fast"
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {command?.kind === 'event_research' && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] text-cream">{t('commands.eventResearching')}</p>
          <p className="text-[13px] text-faint">{command.eventHint}</p>
        </div>
      )}

      {/* relationship suggestions */}
      {suggestions.map((s) => (
        <div key={s.id} className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] text-cream leading-relaxed">{s.message}</p>
          <div className="mt-2 flex gap-2">
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

      {/* event prospect cards */}
      {events.map((ev) => (
        <div key={ev.id} className="mt-3 rounded-3xl bg-card2 border border-line p-4 fade-up">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t('prospects.title')}</p>
          <p className="mt-1 text-[16px] font-semibold">{ev.title}</p>
          {ev.filters && <p className="text-[13px] text-faint">{ev.filters}</p>}
          <div className="mt-3 space-y-2">
            {ev.prospects.filter((p) => p.status === 'prospect').map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-card border border-line px-3 py-2.5">
                <Avatar name={p.name} photo={p.photoUrl} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold truncate">{p.name}</p>
                  {p.headline && <p className="text-[12px] text-muted truncate">{p.headline}</p>}
                </div>
                <button
                  onClick={() => void convertProspect(p.id)}
                  className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-ink active:scale-95 transition-fast"
                >
                  {t('prospects.convert')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {researchingEvent && (
        <div className="mt-3 rounded-2xl px-4 py-3 bg-card2 border border-line">
          <p className="text-[14px] text-muted">{t('prospects.researching')}</p>
        </div>
      )}
      {eventLinkNeeded && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <p className="text-[14px] text-cream">{t('prospects.needLink')}</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={eventLink}
              onChange={(e) => setEventLink(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitEventLink()}
              placeholder={t('prospects.linkPlaceholder')}
              className="flex-1 rounded-2xl bg-card border border-line px-4 py-2.5 text-[14px] outline-none focus:border-accent placeholder:text-faint"
            />
            <button
              onClick={() => void submitEventLink()}
              disabled={!eventLink.trim() || eventLinkBusy}
              className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-ink active:scale-95 transition-fast disabled:opacity-40"
            >
              {t('prospects.send')}
            </button>
          </div>
        </div>
      )}

      {saved && saved.length > 0 && (
        <div className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] font-semibold text-cream">
              {saved.length === 1 ? t('capture.savedOne') : t('capture.savedMany', { count: saved.length })}
            </p>
            <button
              type="button"
              onClick={() => router.push(`/people/${saved[0].personId}`)}
              className="shrink-0 text-[13px] font-semibold text-accent"
            >
              {t('capture.review')}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {saved.map((r) => (
              <button
                key={r.personId}
                type="button"
                onClick={() => router.push(`/people/${r.personId}`)}
                className="rounded-full bg-ink border border-line px-3 py-1.5 text-[14px] text-cream active:scale-95 transition"
              >
                {r.personName}
              </button>
            ))}
          </div>
        </div>
      )}

      {uncertain.map((r) => (
        <div
          key={r.personId}
          className="mt-3 rounded-2xl px-4 py-3 fade-up bg-card2 border border-line"
        >
          <p className="text-[14px] text-cream">{t('capture.heardName', { name: r.personName })}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => confirmName(r.personId)}
              className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-ink active:scale-95 transition"
            >
              {t('capture.heardYes')}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/people/${r.personId}`)}
              className="rounded-full border border-line px-4 py-1.5 text-[13px] font-semibold text-cream active:scale-95 transition"
            >
              {t('capture.heardFix')}
            </button>
          </div>
        </div>
      ))}

      <div className="mt-4 flex-1">
        {people.length === 0 ? (
          <div className="mt-10 text-center px-8">
            <p className="text-[15px] text-muted leading-relaxed">{t('capture.empty')}</p>
          </div>
        ) : (
          <div className="-mx-4 divide-y divide-line/60">
            {people.map((p) => (
              <PersonRow key={p.id} person={p} onDelete={remove} />
            ))}
          </div>
        )}
      </div>

      {/* assistant conversation bubbles */}
      {(assistantChats.length > 0 || assistantThinking) && (
        <div className="mt-4 flex flex-col gap-2">
          {assistantChats.map((chat, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14px] text-white">
                {chat.q}
              </div>
              <div className="self-start max-w-[85%] rounded-2xl rounded-bl-md bg-card2 border border-line px-4 py-2.5 text-[14px] text-cream whitespace-pre-wrap">
                {chat.a}
              </div>
            </div>
          ))}
          {assistantThinking && (
            <div className="self-start rounded-2xl rounded-bl-md bg-card2 border border-line px-4 py-2.5 text-[14px] text-faint">
              {t('assistant.thinking')}
            </div>
          )}
        </div>
      )}

      {/* composer bar; sits at the very bottom while typing (tab bar hides) */}
      <div
        className={
          kbOpen
            ? 'sticky bottom-0 pt-2 bg-gradient-to-t from-ink via-ink to-transparent'
            : 'sticky bottom-[68px] lg:bottom-6 pt-3 bg-gradient-to-t from-ink via-ink to-transparent'
        }
      >
        <div className="lg:max-w-xl lg:mx-auto">
          <Composer initialText={guessName} onSend={send} onStop={stop} placeholder={t('capture.placeholder')} busy={busy} />
        </div>
      </div>
    </div>
  );
}
