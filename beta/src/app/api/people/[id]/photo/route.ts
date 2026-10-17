import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { swapNextPhoto, listPreviousPhotos, revertToPreviousPhoto } from '@/lib/research';

type Ctx = { params: Promise<{ id: string }> };

async function owned(userId: string, personId: string) {
  const rows = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), eq(schema.people.id, personId)))
    .limit(1);
  return rows.length > 0;
}

/** GET: previous photos available for revert (newest first). */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!(await owned(user.id, id))) return Response.json({ error: 'not_found' }, { status: 404 });
  const previous = await listPreviousPhotos(user.id, id);
  return Response.json({
    previous: previous.map((p) => ({ id: p.id, photoUrl: p.photoUrl })),
  });
}

/**
 * POST: "find another photo" — instant swap from the warm cache when possible,
 * otherwise a bounded background lookup (client polls research status).
 * POST { revertTo?: candidateId }: revert to a previous photo (or the most recent one).
 */
export async function POST(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!(await owned(user.id, id))) return Response.json({ error: 'not_found' }, { status: 404 });
  let body: { revertTo?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body → normal "another photo" flow
  }
  if (body && typeof body === 'object' && 'revertTo' in body) {
    const res = await revertToPreviousPhoto(user.id, id, body.revertTo || undefined);
    if (!res.ok) return Response.json({ ok: false, reason: res.reason });
    return Response.json({ ok: true, reverted: true });
  }
  const res = await swapNextPhoto(user.id, id);
  return Response.json(res);
}
