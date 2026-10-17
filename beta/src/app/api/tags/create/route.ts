import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/** Create a tag (or reuse by name) and link it to a person. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: { name?: string; personId?: string; color?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const name = (body.name || '').trim();
  if (!name) return Response.json({ error: 'name_required' }, { status: 400 });
  if (!body.personId) return Response.json({ error: 'person_required' }, { status: 400 });

  const person = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(and(eq(schema.people.userId, user.id), eq(schema.people.id, body.personId)))
    .limit(1);
  if (!person.length) return Response.json({ error: 'person_not_found' }, { status: 404 });

  let tag = await db
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.userId, user.id), eq(schema.tags.name, name)))
    .limit(1)
    .then((r) => r[0]);
  if (!tag) {
    [tag] = await db
      .insert(schema.tags)
      .values({ userId: user.id, name, color: body.color ?? null })
      .returning();
  }
  await db
    .insert(schema.personTags)
    .values({ personId: body.personId, tagId: tag.id })
    .onConflictDoNothing();
  return Response.json({ tag: { id: tag.id, name: tag.name, color: tag.color } });
}
