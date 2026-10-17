import { requireUser } from '@/lib/auth';
import { convertProspect } from '@/lib/research';

type Ctx = { params: Promise<{ id: string }> };

/** POST: "I met them" — convert a prospect into a contact with an encounter. */
export async function POST(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const personId = await convertProspect(user.id, id);
  if (!personId) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ ok: true, personId });
}
