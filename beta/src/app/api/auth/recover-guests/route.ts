import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { mergeGuestIntoUser } from '@/lib/guest-merge';

// Guests whose last activity is older than this are considered abandoned and
// are left alone (the scheduled guest cleanup handles them).
const RECOVER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One-tap recovery for the "I forgot to log in" case: merge recently-active
 * guest accounts that actually hold data into the current (real) account.
 * Only the signed-in owner can trigger it, and only guests with at least one
 * saved person are merged — empty guest shells are skipped.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (user.isGuest) return Response.json({ error: 'not_guest' }, { status: 400 });

  const cutoff = new Date(Date.now() - RECOVER_WINDOW_MS);
  // Only the single most recently active guest is merged. Merging every
  // recent guest risks absorbing another person's (or test) data.
  const [guest] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.isGuest, true),
        ne(schema.users.id, user.id),
        gt(schema.users.lastActiveAt, cutoff),
      ),
    )
    .orderBy(desc(schema.users.lastActiveAt))
    .limit(1);

  const mergedPeople: string[] = [];
  let mergedGuests = 0;
  if (guest) {
    const people = await db
      .select({ name: schema.people.name })
      .from(schema.people)
      .where(eq(schema.people.userId, guest.id))
      .limit(100);
    if (people.length > 0) {
      await mergeGuestIntoUser(guest.id, user.id);
      mergedGuests = 1;
      mergedPeople.push(...people.map((p) => p.name));
    }
  }

  return Response.json({ mergedGuests, mergedPeople });
}
