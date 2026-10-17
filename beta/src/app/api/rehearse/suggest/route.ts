import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { suggestForRehearse } from '@/lib/organizer';
import { toCard } from '@/lib/people-queries';

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  let body: { text?: string; occasionId?: string; tagId?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  let occasionIds: string[] = [];
  let tagIds: string[] = [];
  const matched: { occasions: string[]; tags: string[] } = { occasions: [], tags: [] };

  if (body.occasionId) occasionIds = [body.occasionId];
  else if (body.tagId) tagIds = [body.tagId];
  else if (body.text && body.text.trim()) {
    const s = await suggestForRehearse({ userId: user.id, text: body.text });
    occasionIds = s.occasionIds;
    tagIds = s.tagIds;
    matched.occasions = s.occasionIds;
    matched.tags = s.tagIds;
  }

  // collect person ids linked to these occasions / tags
  const personIds = new Set<string>();
  if (occasionIds.length) {
    const rows = await db
      .select({ personId: schema.encounters.personId })
      .from(schema.encounters)
      .where(and(eq(schema.encounters.userId, user.id), inArray(schema.encounters.occasionId, occasionIds)));
    rows.forEach((r) => personIds.add(r.personId));
  }
  if (tagIds.length) {
    const rows = await db
      .select({ personId: schema.personTags.personId })
      .from(schema.personTags)
      .innerJoin(schema.tags, eq(schema.personTags.tagId, schema.tags.id))
      .where(and(eq(schema.tags.userId, user.id), inArray(schema.tags.id, tagIds)));
    rows.forEach((r) => personIds.add(r.personId));
  }

  let people;
  if (body.all || (!body.occasionId && !body.tagId && !body.text)) {
    const rows = await db
      .select()
      .from(schema.people)
      .where(eq(schema.people.userId, user.id))
      .orderBy(desc(schema.people.updatedAt))
      .limit(200);
    people = await Promise.all(rows.map((p) => toCard(user.id, p)));
  } else {
    const ids = [...personIds];
    if (!ids.length) return Response.json({ people: [], matched });
    const rows = await db
      .select()
      .from(schema.people)
      .where(and(eq(schema.people.userId, user.id), inArray(schema.people.id, ids)));
    people = await Promise.all(rows.map((p) => toCard(user.id, p)));
  }
  // attach each person's most recent conversation snippet ("what we discussed last time")
  const allIds = people.map((p) => p.id);
  const lastByPerson = new Map<string, string>();
  if (allIds.length) {
    const encRows = await db
      .select({ personId: schema.encounters.personId, summary: schema.encounters.summary })
      .from(schema.encounters)
      .where(and(eq(schema.encounters.userId, user.id), inArray(schema.encounters.personId, allIds)))
      .orderBy(desc(schema.encounters.createdAt))
      .limit(500);
    for (const r of encRows) {
      if (!lastByPerson.has(r.personId) && r.summary?.trim()) {
        lastByPerson.set(r.personId, r.summary.trim());
      }
    }
  }
  const withLast = people.map((p) => ({ ...p, lastNote: lastByPerson.get(p.id) ?? null }));
  return Response.json({ people: withLast, matched });
}
