import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getProfile } from '@/lib/people-queries';
import { learnCorrection } from '@/lib/organizer';
import { deletePersonWithSnapshot } from '@/lib/person-snapshot';

type Ctx = { params: Promise<{ id: string }> };

// Editable scalar fields (body keys are camelCase)
const EDITABLE = [
  'name', 'headline', 'summary', 'company', 'roleTitle', 'industry', 'introHook',
  'mutualConnections', 'likelyToMeetAgain', 'theyHelpMeWith', 'iOfferThem', 'appearance',
] as const;

export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const profile = await getProfile(user.id, id);
  if (!profile) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ person: profile });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const cur = await db
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.userId, user.id), eq(schema.people.id, id)))
    .limit(1);
  const person = cur[0];
  if (!person) return Response.json({ error: 'not_found' }, { status: 404 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of EDITABLE) {
    if (key in body) {
      const v = typeof body[key] === 'string' ? (body[key] as string).trim() : null;
      patch[key] = v && v.length ? v : null;
    }
  }

  // Learn corrections + propagate entity renames automatically (no asking)
  const newName = 'name' in patch ? (patch.name as string | null) : undefined;
  if (typeof newName === 'string' && newName && newName !== person.name) {
    await learnCorrection(user.id, person.name, newName, 'person');
  }
  const newCompany = 'company' in patch ? (patch.company as string | null) : undefined;
  if (newCompany !== undefined && (newCompany || '') !== (person.company || '')) {
    await learnCorrection(user.id, person.company, newCompany, 'company');
    // propagate company rename to other contacts using the same entity
    if (person.company) {
      await db
        .update(schema.people)
        .set({ company: newCompany, updatedAt: new Date() })
        .where(and(eq(schema.people.userId, user.id), eq(schema.people.company, person.company)));
    }
  }
  const newRole = 'roleTitle' in patch ? (patch.roleTitle as string | null) : undefined;
  if (newRole !== undefined && (newRole || '') !== (person.roleTitle || '')) {
    await learnCorrection(user.id, person.roleTitle, newRole, 'role');
  }

  await db.update(schema.people).set(patch).where(eq(schema.people.id, id));
  const profile = await getProfile(user.id, id);
  return Response.json({ person: profile });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const snap = await deletePersonWithSnapshot(user.id, id);
  if (!snap) return Response.json({ error: 'not_found' }, { status: 404 });
  // Snapshot is returned so the client can offer Undo.
  return Response.json({ ok: true, deletedName: snap.person.name, snapshot: snap });
}
