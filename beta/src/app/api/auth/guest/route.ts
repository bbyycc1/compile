import { db, schema } from '@/lib/db';
import { createSession } from '@/lib/auth';

/** Create a guest account (no email/password) and sign it in. */
export async function POST() {
  const [user] = await db
    .insert(schema.users)
    .values({ displayName: 'Guest', isGuest: true })
    .returning({
      id: schema.users.id,
      displayName: schema.users.displayName,
      language: schema.users.language,
      isGuest: schema.users.isGuest,
    });
  await createSession(user.id);
  return Response.json({ user });
}
