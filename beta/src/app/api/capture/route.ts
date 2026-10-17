import { requireUser } from '@/lib/auth';
import {
  organizeCapture,
  routeCaptureText,
  applyCommandUpdate,
  guessNames,
  savePendingCapture,
  organizePendingInBackground,
  type ConversationTurn,
} from '@/lib/organizer';
import { runAssistant } from '@/lib/assistant';
import { researchEvent, swapNextPhoto, revertToPreviousPhoto } from '@/lib/research';
import { getLang } from '@/lib/i18n/server';

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  let body: { text?: string; recentTurns?: ConversationTurn[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (!text) return Response.json({ error: 'empty_text' }, { status: 400 });
  const recentTurns = Array.isArray(body.recentTurns) ? body.recentTurns : [];

  try {
    // Route: update command / photo request / name guess / event research / capture
    const intent = await routeCaptureText({ userId: user.id, text, recentTurns, signal: req.signal });

    if (intent.intent === 'update') {
      const { changedFields, personName } = await applyCommandUpdate(user.id, intent.personId, intent.updates, intent.avatar ?? null);
      return Response.json({
        command: {
          kind: 'update',
          personId: intent.personId,
          personName,
          summary: intent.summary,
          changedFields,
          updates: intent.updates,
          ambiguousWith: intent.ambiguousWith ?? [],
        },
      });
    }

    if (intent.intent === 'photo') {
      const swapped = await swapNextPhoto(user.id, intent.personId);
      if (swapped.ok) {
        return Response.json({
          command: { kind: 'photo', personId: intent.personId, personName: intent.personName, status: 'done' },
        });
      }
      return Response.json({
        command: {
          kind: 'photo',
          personId: intent.personId,
          personName: intent.personName,
          status: swapped.status, // 'looking' | 'none'
        },
      });
    }

    if (intent.intent === 'photo_revert') {
      const reverted = await revertToPreviousPhoto(user.id, intent.personId);
      return Response.json({
        command: {
          kind: 'photo_revert',
          personId: intent.personId,
          personName: intent.personName,
          status: reverted.ok ? 'done' : 'none',
        },
      });
    }

    if (intent.intent === 'name_guess') {
      const { contacts, guesses } = await guessNames({ userId: user.id, clues: intent.clues, signal: req.signal });
      return Response.json({ command: { kind: 'name_guess', contacts, guesses } });
    }

    if (intent.intent === 'event_research') {
      // run in background; the card appears when ready (client polls)
      void (async () => {
        try {
          await researchEvent(user.id, intent.eventHint, intent.filters);
        } catch {
          // ignored — client shows the ask-for-link state on empty poll
        }
      })();
      return Response.json({
        command: { kind: 'event_research', eventHint: intent.eventHint, status: 'researching' },
      });
    }

    if (intent.intent === 'assistant') {
      const lang = await getLang(user.language);
      const { response, changed, personNames, deletedSnapshot } = await runAssistant({
        userId: user.id,
        text,
        recentTurns,
        lang,
        signal: req.signal,
      });
      return Response.json({
        command: { kind: 'assistant', response, changed, personNames, deletedSnapshot },
      });
    }

    // default: capture — optimistic. Save the raw note instantly so the client
    // can show "Saved", then organize in the background.
    const pendingId = await savePendingCapture(user.id, text, recentTurns);
    organizePendingInBackground(pendingId, user.id, text, recentTurns);
    return Response.json({ saved: true, pendingId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'organizer_failed';
    // Client hit stop: the request is gone, just end quietly.
    if (msg === 'aborted' || req.signal.aborted) return new Response(null, { status: 499 });
    if (msg === 'empty') return Response.json({ error: 'empty_text' }, { status: 400 });
    if (msg.startsWith('AI found no person')) {
      return Response.json({ error: 'no_person', detail: msg }, { status: 422 });
    }
    return Response.json({ error: 'ai_unavailable', detail: msg }, { status: 503 });
  }
}
