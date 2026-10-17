import { destroySession, getSessionUser } from '@/lib/auth';

export async function POST() {
  await destroySession();
  return Response.json({ ok: true });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ user: null });
  return Response.json({
    user: { id: user.id, email: user.email, displayName: user.displayName, language: user.language, isGuest: user.isGuest },
  });
}
