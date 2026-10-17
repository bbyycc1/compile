import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getProfile } from '@/lib/people-queries';

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const [people, occasions, tags, followUps, glossary] = await Promise.all([
    db.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.userId, user.id)),
    db.select().from(schema.occasions).where(eq(schema.occasions.userId, user.id)),
    db.select().from(schema.tags).where(eq(schema.tags.userId, user.id)),
    db.select().from(schema.followUps).where(eq(schema.followUps.userId, user.id)),
    db.select().from(schema.glossary).where(eq(schema.glossary.userId, user.id)),
  ]);
  const profiles = await Promise.all(people.map((p) => getProfile(user.id, p.id)));

  const payload = {
    exportedAt: new Date().toISOString(),
    user: { email: user.email, displayName: user.displayName, language: user.language },
    people: profiles,
    occasions,
    tags,
    followUps,
    glossary: glossary.map((g) => ({ alias: g.alias, canonical: g.canonical, kind: g.kind })),
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="name-memory-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
