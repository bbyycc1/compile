import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { getSessionUser, hashPassword } from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convert the current guest account into a full account.
 * Sets email/password on the EXISTING user row so all guest data carries over.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.isGuest) return Response.json({ error: 'not_guest' }, { status: 400 });

  let body: { email?: string; password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || '').trim().slice(0, 120);

  if (!email || !password) return Response.json({ error: 'fill_all' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'bad_email' }, { status: 400 });
  if (password.length < 8) return Response.json({ error: 'password_short' }, { status: 400 });

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing.length && existing[0].id !== user.id) {
    return Response.json({ error: 'email_taken' }, { status: 409 });
  }

  const [updated] = await db
    .update(schema.users)
    .set({
      email,
      passwordHash: await hashPassword(password),
      displayName: name || user.displayName,
      isGuest: false,
      lastActiveAt: new Date(),
    })
    .where(eq(schema.users.id, user.id))
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      language: schema.users.language,
      isGuest: schema.users.isGuest,
    });

  return Response.json({ user: updated });
}
