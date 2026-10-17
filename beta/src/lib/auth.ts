import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';

const SESSION_COOKIE = 'session';
const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({ userId, token, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
  }
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = typeof schema.users.$inferSelect;

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.token, token))
    .limit(1);
  if (rows.length === 0) return null;
  const { user, session } = rows[0];
  if (session.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
    return null;
  }
  // Track activity for guest cleanup (throttled to once per hour).
  if (user.lastActiveAt.getTime() < Date.now() - 60 * 60 * 1000) {
    await db
      .update(schema.users)
      .set({ lastActiveAt: new Date() })
      .where(eq(schema.users.id, user.id));
    user.lastActiveAt = new Date();
  }
  return user;
}

/** For API routes: returns the user or a 401 Response. */
export async function requireUser(): Promise<SessionUser | Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return user;
}
