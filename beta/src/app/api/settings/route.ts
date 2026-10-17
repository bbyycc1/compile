import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { normalizeLang, type Lang } from '@/lib/i18n/dict';
import { cookies } from 'next/headers';

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: { language?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const language: Lang = normalizeLang(body.language);
  await db.update(schema.users).set({ language }).where(eq(schema.users.id, user.id));
  const jar = await cookies();
  jar.set('lang', language, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  return Response.json({ ok: true, language });
}
