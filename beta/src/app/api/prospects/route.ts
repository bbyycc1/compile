import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/** GET: prospect events with their prospects (not-yet-met people stay separate). */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const events = await db
    .select()
    .from(schema.prospectEvents)
    .where(eq(schema.prospectEvents.userId, user.id))
    .orderBy(desc(schema.prospectEvents.createdAt))
    .limit(20);
  const out = await Promise.all(
    events.map(async (ev) => {
      const ps = await db
        .select()
        .from(schema.prospects)
        .where(and(eq(schema.prospects.userId, user.id), eq(schema.prospects.eventId, ev.id)))
        .orderBy(schema.prospects.createdAt);
      return {
        id: ev.id,
        title: ev.title,
        sourceUrl: ev.sourceUrl,
        filters: ev.filters,
        createdAt: ev.createdAt.toISOString(),
        prospects: ps.map((p) => ({
          id: p.id,
          name: p.name,
          headline: p.headline,
          company: p.company,
          roleTitle: p.roleTitle,
          reason: p.reason,
          photoUrl: p.photoUrl,
          status: p.status,
          personId: p.personId,
        })),
      };
    }),
  );
  return Response.json({ events: out });
}
