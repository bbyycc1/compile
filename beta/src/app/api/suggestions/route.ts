import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/** GET: pending relationship suggestions for the user. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const rows = await db
    .select({
      id: schema.relationshipSuggestions.id,
      personId: schema.relationshipSuggestions.personId,
      message: schema.relationshipSuggestions.message,
      createdAt: schema.relationshipSuggestions.createdAt,
    })
    .from(schema.relationshipSuggestions)
    .where(
      and(
        eq(schema.relationshipSuggestions.userId, user.id),
        eq(schema.relationshipSuggestions.status, 'pending'),
      ),
    )
    .orderBy(desc(schema.relationshipSuggestions.createdAt))
    .limit(20);
  const withNames = await Promise.all(
    rows.map(async (r) => {
      const [p] = await db
        .select({ name: schema.people.name })
        .from(schema.people)
        .where(eq(schema.people.id, r.personId))
        .limit(1);
      return { ...r, personName: p?.name ?? null, createdAt: r.createdAt.toISOString() };
    }),
  );
  return Response.json({ suggestions: withNames });
}
