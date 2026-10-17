import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const rows = await db
    .select()
    .from(schema.glossary)
    .where(eq(schema.glossary.userId, user.id))
    .orderBy(desc(schema.glossary.createdAt));
  return Response.json({
    glossary: rows.map((g) => ({ id: g.id, alias: g.alias, canonical: g.canonical, kind: g.kind })),
  });
}

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  await db
    .delete(schema.glossary)
    .where(and(eq(schema.glossary.userId, user.id), eq(schema.glossary.id, id)));
  return Response.json({ ok: true });
}
