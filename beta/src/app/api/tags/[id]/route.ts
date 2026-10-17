import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { learnCorrection } from '@/lib/organizer';

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const rows = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.userId, user.id))
    .orderBy(asc(schema.tags.name));
  return Response.json({
    tags: rows.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  });
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  let body: { name?: string; color?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const cur = await db
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.userId, user.id), eq(schema.tags.id, id)))
    .limit(1);
  const tag = cur[0];
  if (!tag) return Response.json({ error: 'not_found' }, { status: 404 });

  const patch: { name?: string; color?: string | null } = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return Response.json({ error: 'name_required' }, { status: 400 });
    if (name !== tag.name) {
      // shared tag row → rename is global automatically; remember the correction
      await learnCorrection(user.id, tag.name, name, 'tag');
      patch.name = name;
    }
  }
  if (body.color !== undefined) {
    patch.color =
      typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
  }
  if (Object.keys(patch).length) {
    await db.update(schema.tags).set(patch).where(eq(schema.tags.id, id));
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  await db.delete(schema.tags).where(and(eq(schema.tags.userId, user.id), eq(schema.tags.id, id)));
  return Response.json({ ok: true });
}
