import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const rows = await db
    .select()
    .from(schema.occasions)
    .where(eq(schema.occasions.userId, user.id))
    .orderBy(desc(schema.occasions.updatedAt));
  return Response.json({
    occasions: rows.map((o) => ({
      id: o.id,
      name: o.name,
      locationDetail: o.locationDetail,
    })),
  });
}
