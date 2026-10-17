import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { createSession, getSessionUser, verifyPassword } from '@/lib/auth';
import { mergeGuestIntoUser } from '@/lib/guest-merge';

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return Response.json({ error: 'fill_all' }, { status: 400 });

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: 'bad_credentials' }, { status: 401 });
  }
  // If the visitor was using the app as a guest, fold the guest's data into
  // this account instead of orphaning it (orphaned guest rows are eventually
  // cleaned up, which used to silently wipe the guest-added contacts).
  const current = await getSessionUser();
  if (current?.isGuest && current.id !== user.id) {
    await mergeGuestIntoUser(current.id, user.id);
  }
  await createSession(user.id);
  return Response.json({
    user: { id: user.id, email: user.email, displayName: user.displayName, language: user.language },
  });
}
