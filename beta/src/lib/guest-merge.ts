import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { mergeDuplicatePeople } from './organizer';

/**
 * Move everything owned by a guest user onto a real account, then remove the
 * guest row. Used when someone used the app as a guest and then logs in (or
 * signs up for a separate account): without this, the guest row is orphaned
 * and its data is eventually wiped by guest cleanup.
 */
export async function mergeGuestIntoUser(guestId: string, targetUserId: string): Promise<void> {
  if (!guestId || !targetUserId || guestId === targetUserId) return;

  // Every user-owned table points at users.id with onDelete: 'cascade', so
  // re-pointing userId is enough to transfer ownership (person_tags and other
  // join rows follow their parent person/tag rows).
  await db.update(schema.people).set({ userId: targetUserId }).where(eq(schema.people.userId, guestId));
  await db.update(schema.occasions).set({ userId: targetUserId }).where(eq(schema.occasions.userId, guestId));
  await db.update(schema.encounters).set({ userId: targetUserId }).where(eq(schema.encounters.userId, guestId));
  await db.update(schema.tags).set({ userId: targetUserId }).where(eq(schema.tags.userId, guestId));
  await db.update(schema.followUps).set({ userId: targetUserId }).where(eq(schema.followUps.userId, guestId));
  await db.update(schema.glossary).set({ userId: targetUserId }).where(eq(schema.glossary.userId, guestId));
  await db.update(schema.backgroundBriefs).set({ userId: targetUserId }).where(eq(schema.backgroundBriefs.userId, guestId));
  await db.update(schema.prospectEvents).set({ userId: targetUserId }).where(eq(schema.prospectEvents.userId, guestId));
  await db.update(schema.prospects).set({ userId: targetUserId }).where(eq(schema.prospects.userId, guestId));
  await db.update(schema.relationshipSuggestions).set({ userId: targetUserId }).where(eq(schema.relationshipSuggestions.userId, guestId));
  await db.update(schema.photoCandidates).set({ userId: targetUserId }).where(eq(schema.photoCandidates.userId, guestId));
  await db.update(schema.researchJobs).set({ userId: targetUserId }).where(eq(schema.researchJobs.userId, guestId));
  await db.update(schema.pendingCaptures).set({ userId: targetUserId }).where(eq(schema.pendingCaptures.userId, guestId));

  // Carry over profile bits the guest may have set (about-me, learned facts,
  // an explicitly chosen language) without overwriting the account's own.
  const [guest] = await db.select().from(schema.users).where(eq(schema.users.id, guestId)).limit(1);
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).limit(1);
  if (guest && target) {
    const seen = new Set((target.profileFacts || []).map((f) => f.fact));
    const mergedFacts = [...(target.profileFacts || [])];
    for (const f of guest.profileFacts || []) {
      if (!seen.has(f.fact)) {
        mergedFacts.push(f);
        seen.add(f.fact);
      }
    }
    await db
      .update(schema.users)
      .set({
        aboutMe: target.aboutMe || guest.aboutMe,
        profileFacts: mergedFacts,
        language: target.language === 'en' && guest.language !== 'en' ? guest.language : target.language,
        lastActiveAt: new Date(),
      })
      .where(eq(schema.users.id, targetUserId));
  }

  // Remove the guest row; its sessions cascade.
  await db.delete(schema.users).where(eq(schema.users.id, guestId));

  // Fold duplicate people (same name in both guest and account) into one.
  await mergeDuplicatePeople(targetUserId);
}
