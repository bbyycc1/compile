import { requireUser } from '@/lib/auth';
import { applyCommandUpdate } from '@/lib/organizer';

/** POST {personId, updates}: re-apply an update command to a different person (ambiguity resolution). */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: { personId?: string; updates?: Record<string, string | null> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (!body.personId || !body.updates || typeof body.updates !== 'object') {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const { changedFields, personName } = await applyCommandUpdate(user.id, body.personId, body.updates);
    return Response.json({ ok: true, personId: body.personId, personName, changedFields });
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
}
