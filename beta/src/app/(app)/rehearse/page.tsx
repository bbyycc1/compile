'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import VoiceInput from '@/components/VoiceInput';
import { useLang } from '@/lib/i18n/provider';
import type { PersonCard } from '@/lib/people-queries';

type Occasion = { id: string; name: string; locationDetail: string | null };
type Mode = 'browse' | 'quiz';
type QuizDir = 'details2name' | 'name2details';

/**
 * One screen, no page scroll: compact heading, text box near top,
 * occasion chips below, suggestion cards, both-directions quiz.
 */
export default function RehearsePage() {
  const { t } = useLang();
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PersonCard[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('browse');
  const [quizDir, setQuizDir] = useState<QuizDir>('details2name');
  const [order, setOrder] = useState<number[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadOccasions = useCallback(async () => {
    const res = await fetch('/api/occasions');
    if (res.ok) {
      const data = await res.json();
      setOccasions(data.occasions);
    }
  }, []);

  useEffect(() => {
    void loadOccasions();
  }, [loadOccasions]);

  const suggest = async (body: Record<string, unknown>, label: string | null) => {
    setLoading(true);
    try {
      const res = await fetch('/api/rehearse/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setPeople(data.people);
        setActiveLabel(label);
        setMode('browse');
      }
    } finally {
      setLoading(false);
    }
  };

  const startQuiz = (dir: QuizDir) => {
    if (!people.length) return;
    const o = people.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [o[i], o[j]] = [o[j], o[i]];
    }
    setOrder(o);
    setIdx(0);
    setRevealed(false);
    setQuizDir(dir);
    setMode('quiz');
  };

  const next = () => {
    setIdx((i) => (i + 1) % order.length);
    setRevealed(false);
  };

  const current: PersonCard | null = mode === 'quiz' && order.length ? people[order[idx]] : null;

  return (
    <div className="px-4 pt-8 h-dvh flex flex-col overflow-hidden lg:max-w-5xl w-full">
      <h1 className="text-[26px] font-bold tracking-tight">{t('rehearse.heading')}</h1>

      {/* text box near top */}
      <div className="mt-3">
        <VoiceInput
          value={query}
          onChange={setQuery}
          placeholder={t('rehearse.inputPlaceholder')}
          onSubmit={() => query.trim() && void suggest({ text: query.trim() }, query.trim())}
        />
      </div>

      {/* occasion chips below the box */}
      <div className="mt-2.5 nice-scroll flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        <button
          onClick={() => void suggest({ all: true }, t('rehearse.allNames'))}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-fast active:scale-95 ${
            activeLabel === t('rehearse.allNames') ? 'bg-accent text-ink' : 'bg-card2 border border-line text-muted'
          }`}
        >
          {t('rehearse.allNames')}
        </button>
        {occasions.map((o) => (
          <button
            key={o.id}
            onClick={() => void suggest({ occasionId: o.id }, o.name)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-fast active:scale-95 ${
              activeLabel === o.name ? 'bg-accent text-ink' : 'bg-card2 border border-line text-muted'
            }`}
          >
            {o.name}
          </button>
        ))}
      </div>

      {/* cards area */}
      <div className="flex-1 min-h-0 mt-2">
        {mode === 'browse' ? (
          loading ? (
            <div className="h-full flex items-center justify-center">
              <span className="w-6 h-6 border-2 border-faint border-t-accent rounded-full animate-spin" />
            </div>
          ) : people.length === 0 ? (
            <div className="h-full flex items-center justify-center px-8">
              <p className="text-center text-[14px] text-faint leading-relaxed">{t('rehearse.quiz.empty')}</p>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <div className="nice-scroll flex-1 flex gap-3 overflow-x-auto items-stretch py-1 snap-x">
                {people.map((p) => (
                  <Link
                    key={p.id}
                    href={`/people/${p.id}`}
                    className="snap-center shrink-0 w-[62%] rounded-3xl bg-card2 border border-line p-4 flex flex-col items-center justify-center text-center active:scale-[0.98] transition-fast"
                  >
                    <Avatar name={p.name} photo={p.avatarPhoto} color={p.avatarColor || p.tags[0]?.color} size={64} />
                    <p className="mt-2.5 text-[17px] font-semibold">{p.name}</p>
                    {p.headline && <p className="mt-1 text-[13px] text-muted leading-snug line-clamp-3">{p.headline}</p>}
                    {p.lastNote && (
                      <p className="mt-2 text-[12px] text-muted leading-snug line-clamp-3">
                        <span className="text-faint">{t('rehearse.lastTime')}: </span>
                        {p.lastNote}
                      </p>
                    )}
                    {p.occasions.length > 0 && (
                      <p className="mt-2 text-[12px] text-faint truncate max-w-full">{p.occasions.join(' · ')}</p>
                    )}
                  </Link>
                ))}
              </div>
              <div className="py-2.5 flex gap-2">
                <button
                  onClick={() => startQuiz('details2name')}
                  className="flex-1 rounded-2xl bg-accent py-3 text-[14px] font-semibold text-ink active:scale-[0.98] transition-fast"
                >
                  {t('rehearse.quiz.detailsToName')}
                </button>
                <button
                  onClick={() => startQuiz('name2details')}
                  className="flex-1 rounded-2xl bg-card2 border border-line py-3 text-[14px] font-medium active:scale-[0.98] transition-fast"
                >
                  {t('rehearse.quiz.nameToDetails')}
                </button>
              </div>
            </div>
          )
        ) : current ? (
          <div className="h-full flex flex-col pb-2">
            <div className="flex items-center justify-between">
              <button onClick={() => setMode('browse')} className="text-[14px] text-accent font-medium active:scale-95 transition-fast">
                ‹ {t('common.back')}
              </button>
              <p className="text-[13px] text-faint">
                {idx + 1} / {order.length}
              </p>
              <button
                onClick={() => startQuiz(quizDir === 'details2name' ? 'name2details' : 'details2name')}
                className="text-[13px] text-muted active:text-cream transition-fast"
              >
                ⇄ {quizDir === 'details2name' ? t('rehearse.quiz.nameToDetails') : t('rehearse.quiz.detailsToName')}
              </button>
            </div>

            <button
              onClick={() => setRevealed((v) => !v)}
              className="mt-2 flex-1 min-h-0 rounded-3xl bg-card2 border border-line p-5 flex flex-col items-center justify-center text-center active:scale-[0.99] transition-fast"
            >
              {quizDir === 'details2name' ? (
                revealed ? (
                  <div className="fade-up flex flex-col items-center">
                    <Avatar name={current.name} photo={current.avatarPhoto} color={current.avatarColor || current.tags[0]?.color} size={72} />
                    <p className="mt-3 text-[24px] font-bold">{current.name}</p>
                    {current.headline && <p className="mt-1 text-[14px] text-muted">{current.headline}</p>}
                  </div>
                ) : (
                  <div className="fade-up">
                    {current.headline && <p className="text-[17px] leading-relaxed">{current.headline}</p>}
                    {current.summary && <p className="mt-2 text-[14px] text-muted leading-relaxed line-clamp-4">{current.summary}</p>}
                    {current.occasions.length > 0 && (
                      <p className="mt-3 text-[13px] text-accent font-medium">{current.occasions.join(' · ')}</p>
                    )}
                    <p className="mt-4 text-[13px] text-faint">{t('rehearse.quiz.tapToReveal')}</p>
                  </div>
                )
              ) : revealed ? (
                <div className="fade-up">
                  {current.headline && <p className="text-[16px] leading-relaxed">{current.headline}</p>}
                  {current.summary && <p className="mt-2 text-[14px] text-muted leading-relaxed line-clamp-5">{current.summary}</p>}
                  {current.occasions.length > 0 && (
                    <p className="mt-3 text-[13px] text-accent font-medium">{current.occasions.join(' · ')}</p>
                  )}
                </div>
              ) : (
                <div className="fade-up flex flex-col items-center">
                  <Avatar name={current.name} photo={current.avatarPhoto} color={current.avatarColor || current.tags[0]?.color} size={72} />
                  <p className="mt-3 text-[24px] font-bold">{current.name}</p>
                  <p className="mt-4 text-[13px] text-faint">{t('rehearse.quiz.tapToReveal')}</p>
                </div>
              )}
            </button>

            <div className="py-2.5 flex gap-2">
              <button onClick={next} className="flex-1 rounded-2xl bg-card2 border border-line py-2.5 text-[14px] font-medium active:scale-[0.98] transition-fast">
                {t('rehearse.quiz.next')}
              </button>
              <button onClick={next} className="flex-1 rounded-2xl bg-accent py-2.5 text-[14px] font-semibold text-ink active:scale-[0.98] transition-fast">
                {t('rehearse.quiz.knewIt')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
