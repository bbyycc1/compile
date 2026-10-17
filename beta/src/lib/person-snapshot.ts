import { and, eq } from 'drizzle-orm';
import { db } from './db';
import * as schema from './db/schema';

export type PersonSnapshot = {
  person: typeof schema.people.$inferSelect;
  encounters: (typeof schema.encounters.$inferSelect)[];
  personTags: (typeof schema.personTags.$inferSelect)[];
  followUps: (typeof schema.followUps.$inferSelect)[];
};

/** Capture everything needed to restore a person after deletion. */
export async function snapshotPerson(userId: string, personId: string): Promise<PersonSnapshot | null> {
  const people = await db
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), eq(schema.people.id, personId)))
    .limit(1);
  if (!people[0]) return null;
  const [encounters, personTags, followUps] = await Promise.all([
    db
      .select()
      .from(schema.encounters)
      .where(and(eq(schema.encounters.userId, userId), eq(schema.encounters.personId, personId))),
    db.select().from(schema.personTags).where(eq(schema.personTags.personId, personId)),
    db
      .select()
      .from(schema.followUps)
      .where(and(eq(schema.followUps.userId, userId), eq(schema.followUps.personId, personId))),
  ]);
  return { person: people[0], encounters, personTags, followUps };
}

/** Restore a person from a snapshot, preserving original IDs and relations. */
export async function restorePerson(userId: string, snap: PersonSnapshot): Promise<void> {
  if (snap.person.userId !== userId) throw new Error('snapshot belongs to another user');
  // Insert person first (encounters reference it). Ignore if already restored.
  await db.insert(schema.people).values(snap.person).onConflictDoNothing();
  if (snap.encounters.length) {
    await db.insert(schema.encounters).values(snap.encounters).onConflictDoNothing();
  }
  if (snap.personTags.length) {
    await db.insert(schema.personTags).values(snap.personTags).onConflictDoNothing();
  }
  if (snap.followUps.length) {
    await db.insert(schema.followUps).values(snap.followUps).onConflictDoNothing();
  }
}

/** Hard-delete a person and everything attached. Returns a snapshot for undo. */
export async function deletePersonWithSnapshot(
  userId: string,
  personId: string,
): Promise<PersonSnapshot | null> {
  const snap = await snapshotPerson(userId, personId);
  if (!snap) return null;
  await db
    .delete(schema.followUps)
    .where(and(eq(schema.followUps.userId, userId), eq(schema.followUps.personId, personId)));
  // encounters and person_tags cascade via FK
  await db.delete(schema.people).where(eq(schema.people.id, personId));
  return snap;
}
