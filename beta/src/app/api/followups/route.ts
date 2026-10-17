import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

function shape(f: typeof schema.followUps.$inferSelect, personName: string | null) {
  return {
    id: f.id,
    text: f.text,
    dueDate: f.dueDate,
    done: f.done,
    personId: f.personId,
    personName,
    createdAt: f.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const url = new URL(req.url);
  const show = url.searchParams.get('done'); // 'all' | 'open' | 'done'

  const rows = await db
    .select({ f: schema.followUps, personName: schema.people.name })
    .from(schema.followUps)
    .leftJoin(schema.people, eq(schema.followUps.personId, schema.people.id))
    .where(eq(schema.followUps.userId, user.id))
    .orderBy(desc(schema.followUps.createdAt));

  let list = rows.map((r) => shape(r.f, r.personName));
  if (show === 'open') list = list.filter((f) => !f.done);
  else if (show === 'done') list = list.filter((f) => f.done);
  return Response.json({ followUps: list });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: { text?: string; dueDate?: string | null; personId?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (!text) return Response.json({ error: 'text_required' }, { status: 400 });
  let dueDate: string | null = null;
  if (body.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) dueDate = body.dueDate;

  let personId: string | null = null;
  if (body.personId) {
    const p = await db
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(and(eq(schema.people.userId, user.id), eq(schema.people.id, body.personId)))
      .limit(1);
    if (!p.length) return Response.json({ error: 'person_not_found' }, { status: 404 });
    personId = p[0].id;
  }

  const [row] = await db
    .insert(schema.followUps)
    .values({ userId: user.id, personId, text, dueDate })
    .returning();
  return Response.json({ followUp: shape(row, null) });
}
