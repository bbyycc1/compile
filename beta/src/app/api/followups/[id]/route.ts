import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  let body: { text?: string; dueDate?: string | null; done?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const cur = await db
    .select()
    .from(schema.followUps)
    .where(and(eq(schema.followUps.userId, user.id), eq(schema.followUps.id, id)))
    .limit(1);
  if (!cur.length) return Response.json({ error: 'not_found' }, { status: 404 });

  const patch: Partial<typeof schema.followUps.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.text === 'string') {
    const t = body.text.trim();
    if (!t) return Response.json({ error: 'text_required' }, { status: 400 });
    patch.text = t;
  }
  if (body.dueDate !== undefined) {
    patch.dueDate = body.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null;
  }
  if (typeof body.done === 'boolean') patch.done = body.done;

  const [row] = await db.update(schema.followUps).set(patch).where(eq(schema.followUps.id, id)).returning();
  return Response.json({
    followUp: {
      id: row.id,
      text: row.text,
      dueDate: row.dueDate,
      done: row.done,
      personId: row.personId,
      createdAt: row.createdAt.toISOString(),
    },
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  await db
    .delete(schema.followUps)
    .where(and(eq(schema.followUps.userId, user.id), eq(schema.followUps.id, id)));
  return Response.json({ ok: true });
}
