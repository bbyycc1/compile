import { requireUser } from '@/lib/auth';
import { restorePerson, type PersonSnapshot } from '@/lib/person-snapshot';

/** Undo a delete: re-insert a person snapshot captured at delete time. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let snapshot: PersonSnapshot | null = null;
  try {
    const body = await req.json();
    snapshot = body?.snapshot ?? null;
  } catch {}
  if (!snapshot || !snapshot.person?.id) {
    return Response.json({ error: 'missing_snapshot' }, { status: 400 });
  }
  try {
    await restorePerson(user.id, snapshot);
  } catch {
    return Response.json({ error: 'restore_failed' }, { status: 500 });
  }
  return Response.json({ ok: true, restoredName: snapshot.person.name });
}
