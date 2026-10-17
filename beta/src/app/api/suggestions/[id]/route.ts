import { requireUser } from '@/lib/auth';
import { acceptSuggestion, dismissSuggestion } from '@/lib/research';

type Ctx = { params: Promise<{ id: string }> };

/** POST {action: 'accept'|'dismiss'} — one-tap confirm, never auto-asserted. */
export async function POST(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (body.action === 'accept') {
    await acceptSuggestion(user.id, id);
    return Response.json({ ok: true });
  }
  if (body.action === 'dismiss') {
    await dismissSuggestion(user.id, id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'bad_request' }, { status: 400 });
}
