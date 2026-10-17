import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

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
