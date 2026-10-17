import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db, schema } from '@/lib/db';
import { createSession, getSessionUser, hashPassword } from '@/lib/auth';
import { mergeGuestIntoUser } from '@/lib/guest-merge';
import { normalizeLang } from '@/lib/i18n/dict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
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
  if (existing.length) return Response.json({ error: 'email_taken' }, { status: 409 });

  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: await hashPassword(password),
      displayName: name || null,
      // carry over the language they picked on the login/signup screen
      language: normalizeLang((await cookies()).get('lang')?.value),
    })
    .returning({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, language: schema.users.language });

  // Same guest-data protection as login: if the visitor had a guest session,
  // fold it into the new account instead of orphaning it.
  const current = await getSessionUser();
  if (current?.isGuest && current.id !== user.id) {
    await mergeGuestIntoUser(current.id, user.id);
  }

  await createSession(user.id);
  return Response.json({ user });
}
