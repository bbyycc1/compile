import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from './db';
import type { AvatarSpec } from '@/components/AvatarFigure';

export type PersonCard = {
  id: string;
  name: string;
  headline: string | null;
  summary: string | null;
  company: string | null;
  roleTitle: string | null;
  avatarPhoto: string | null;
  avatarColor: string | null;
  avatarSpec: AvatarSpec | null;
  tags: { id: string; name: string; color: string | null }[];
  occasions: string[];
  updatedAt: string;
  /** most recent encounter summary — populated by rehearse/event-prep */
  lastNote?: string | null;
};

export async function personTags(personId: string) {
  const rows = await db
    .select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
    .from(schema.personTags)
    .innerJoin(schema.tags, eq(schema.personTags.tagId, schema.tags.id))
    .where(eq(schema.personTags.personId, personId));
  return rows;
}

export async function personOccasions(userId: string, personId: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.occasions.name })
    .from(schema.encounters)
    .innerJoin(schema.occasions, eq(schema.encounters.occasionId, schema.occasions.id))
    .where(and(eq(schema.encounters.userId, userId), eq(schema.encounters.personId, personId)))
    .orderBy(desc(schema.encounters.createdAt))
    .limit(10);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (!seen.has(r.name)) {
      seen.add(r.name);
      out.push(r.name);
    }
  }
  return out.slice(0, 3);
}

export async function toCard(
  userId: string,
  p: typeof schema.people.$inferSelect,
): Promise<PersonCard> {
  const [tags, occasions] = await Promise.all([
    personTags(p.id),
    personOccasions(userId, p.id),
  ]);
  return {
    id: p.id,
    name: p.name,
    headline: p.headline,
    summary: p.summary,
    company: p.company,
    roleTitle: p.roleTitle,
    avatarPhoto: p.avatarPhoto,
    avatarColor: p.avatarColor,
    avatarSpec: p.avatarSpec,
    tags,
    occasions,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listPeople(userId: string, q?: string, tagId?: string): Promise<PersonCard[]> {
  const filters = [eq(schema.people.userId, userId)];
  const term = (q || '').trim();
  if (term) {
    const like = `%${term.replace(/[%_]/g, '')}%`;
    filters.push(
      or(
        ilike(schema.people.name, like),
        ilike(schema.people.company, like),
        ilike(schema.people.headline, like),
        ilike(schema.people.summary, like),
      )!,
    );
  }
  if (tagId) {
    const linked = await db
      .select({ personId: schema.personTags.personId })
      .from(schema.personTags)
      .innerJoin(schema.tags, eq(schema.personTags.tagId, schema.tags.id))
      .where(and(eq(schema.tags.userId, userId), eq(schema.tags.id, tagId)));
    const ids = linked.map((l) => l.personId);
    if (!ids.length) return [];
    filters.push(inArray(schema.people.id, ids));
  }
  const rows = await db
    .select()
    .from(schema.people)
    .where(and(...filters))
    .orderBy(desc(schema.people.updatedAt))
    .limit(200);
  return Promise.all(rows.map((p) => toCard(userId, p)));
}

export async function getProfile(userId: string, personId: string) {
  const rows = await db
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), eq(schema.people.id, personId)))
    .limit(1);
  const p = rows[0];
  if (!p) return null;
  const [tags, encounters, followUps] = await Promise.all([
    personTags(p.id),
    db
      .select({
        id: schema.encounters.id,
        summary: schema.encounters.summary,
        originalNote: schema.encounters.originalNote,
        occasionName: schema.occasions.name,
        createdAt: schema.encounters.createdAt,
      })
      .from(schema.encounters)
      .leftJoin(schema.occasions, eq(schema.encounters.occasionId, schema.occasions.id))
      .where(and(eq(schema.encounters.userId, userId), eq(schema.encounters.personId, personId)))
      .orderBy(desc(schema.encounters.createdAt)),
    db
      .select()
      .from(schema.followUps)
      .where(and(eq(schema.followUps.userId, userId), eq(schema.followUps.personId, personId)))
      .orderBy(desc(schema.followUps.createdAt)),
  ]);
  return {
    id: p.id,
    name: p.name,
    headline: p.headline,
    summary: p.summary,
    company: p.company,
    roleTitle: p.roleTitle,
    industry: p.industry,
    introHook: p.introHook,
    mutualConnections: p.mutualConnections,
    likelyToMeetAgain: p.likelyToMeetAgain,
    theyHelpMeWith: p.theyHelpMeWith,
    iOfferThem: p.iOfferThem,
    appearance: p.appearance,
    avatarPhoto: p.avatarPhoto,
    avatarColor: p.avatarColor,
    avatarSpec: p.avatarSpec,
    tags,
    encounters: encounters.map((e) => ({
      id: e.id,
      summary: e.summary,
      originalNote: e.originalNote,
      occasionName: e.occasionName,
      createdAt: e.createdAt.toISOString(),
    })),
    followUps: followUps.map((f) => ({
      id: f.id,
      text: f.text,
      dueDate: f.dueDate,
      done: f.done,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}
