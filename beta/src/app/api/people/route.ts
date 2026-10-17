import { requireUser } from '@/lib/auth';
import { listPeople } from '@/lib/people-queries';
import { db, schema } from '@/lib/db';

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const url = new URL(req.url);
  const cards = await listPeople(
    user.id,
    url.searchParams.get('q') ?? undefined,
    url.searchParams.get('tag') ?? undefined,
  );
  return Response.json({ people: cards });
}

/** POST: manually add a person (name + a few fields, no AI needed). */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return Response.json({ error: 'empty_name' }, { status: 400 });
  const str = (k: string) => {
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const [row] = await db
    .insert(schema.people)
    .values({
      userId: user.id,
      name,
      headline: str('headline'),
      company: str('company'),
      roleTitle: str('roleTitle'),
      industry: str('industry'),
      summary: str('summary'),
    })
    .returning({ id: schema.people.id });
  return Response.json({ ok: true, personId: row.id });
}
