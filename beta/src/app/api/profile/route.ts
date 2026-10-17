import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

async function loadProfile(userId: string) {
  const [row] = await db
    .select({ aboutMe: schema.users.aboutMe, profileFacts: schema.users.profileFacts })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return { aboutMe: row?.aboutMe ?? null, facts: row?.profileFacts ?? [] };
}

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return Response.json(await loadProfile(user.id));
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: { aboutMe?: string; deleteFactIndex?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof body.aboutMe === 'string') {
    const v = body.aboutMe.trim();
    await db.update(schema.users).set({ aboutMe: v || null }).where(eq(schema.users.id, user.id));
  }
  if (typeof body.deleteFactIndex === 'number') {
    const [row] = await db
      .select({ profileFacts: schema.users.profileFacts })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    const facts = [...(row?.profileFacts ?? [])];
    if (body.deleteFactIndex >= 0 && body.deleteFactIndex < facts.length) {
      facts.splice(body.deleteFactIndex, 1);
      await db.update(schema.users).set({ profileFacts: facts }).where(eq(schema.users.id, user.id));
    }
  }
  return Response.json({ ok: true, ...(await loadProfile(user.id)) });
}
