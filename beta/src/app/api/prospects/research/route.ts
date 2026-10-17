import { requireUser } from '@/lib/auth';
import { researchEvent } from '@/lib/research';

/**
 * POST {eventHint, filters?, sourceUrl?}: run event research now and return the
 * result. Used when the user pastes an event link manually.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: { eventHint?: string; filters?: string | null; sourceUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const eventHint = (body.eventHint || '').trim();
  if (!eventHint && !body.sourceUrl) return Response.json({ error: 'empty_text' }, { status: 400 });
  try {
    const result = await researchEvent(user.id, eventHint, body.filters ?? null, body.sourceUrl);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { ok: false, needLink: true, eventHint, detail: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
