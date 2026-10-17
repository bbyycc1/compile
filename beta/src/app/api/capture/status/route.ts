import { requireUser } from '@/lib/auth';
import { getPendingCapture } from '@/lib/organizer';

/** Poll the status of an optimistic capture: pending | done | failed. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { searchParams } = new URL(req.url);
  const pendingId = searchParams.get('pendingId');
  if (!pendingId) return Response.json({ error: 'bad_request' }, { status: 400 });

  const pending = await getPendingCapture(pendingId, user.id);
  if (!pending) return Response.json({ error: 'not_found' }, { status: 404 });

  return Response.json({
    status: pending.status,
    results: pending.status === 'done' ? pending.result : null,
    error: pending.status === 'failed' ? pending.error : null,
  });
}
