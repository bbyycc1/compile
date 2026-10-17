import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { learnCorrection } from '@/lib/organizer';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  let body: { name?: string; locationDetail?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const cur = await db
    .select()
    .from(schema.occasions)
    .where(and(eq(schema.occasions.userId, user.id), eq(schema.occasions.id, id)))
    .limit(1);
  const occ = cur[0];
  if (!occ) return Response.json({ error: 'not_found' }, { status: 404 });

  const name = (body.name || '').trim();
  if (!name) return Response.json({ error: 'name_required' }, { status: 400 });
  if (name !== occ.name) {
    // shared row → rename propagates everywhere automatically; remember the correction
    await learnCorrection(user.id, occ.name, name, 'occasion');
  }
  await db
    .update(schema.occasions)
    .set({
      name,
      locationDetail: typeof body.locationDetail === 'string' ? body.locationDetail.trim() || null : occ.locationDetail,
      updatedAt: new Date(),
    })
    .where(eq(schema.occasions.id, id));
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  await db
    .delete(schema.occasions)
    .where(and(eq(schema.occasions.userId, user.id), eq(schema.occasions.id, id)));
  return Response.json({ ok: true });
}
