import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 400 * 1024; // resized client-side; sanity cap

export async function POST(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;

  let body: { photo?: string | null; color?: string | null; remove?: boolean; spec?: Record<string, string | null> | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const cur = await db
    .select({ id: schema.people.id, avatarPhoto: schema.people.avatarPhoto })
    .from(schema.people)
    .where(and(eq(schema.people.userId, user.id), eq(schema.people.id, id)))
    .limit(1);
  if (!cur.length) return Response.json({ error: 'not_found' }, { status: 404 });

  const patch: { avatarPhoto?: string | null; avatarColor?: string | null; avatarSpec?: Record<string, string | null> | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (body.remove) {
    // keep the removed photo in history so it can be restored
    if (cur[0].avatarPhoto) {
      await db.insert(schema.photoCandidates).values({
        userId: user.id,
        personId: id,
        photoUrl: cur[0].avatarPhoto,
        sourceLabel: 'previous',
      });
    }
    patch.avatarPhoto = null;
  } else if (typeof body.photo === 'string') {
    if (!body.photo.startsWith('data:image/')) {
      return Response.json({ error: 'bad_image' }, { status: 400 });
    }
    if (body.photo.length > MAX_BYTES * 1.4) {
      return Response.json({ error: 'image_too_large' }, { status: 413 });
    }
    // keep the replaced photo in history so it can be restored
    if (cur[0].avatarPhoto && cur[0].avatarPhoto !== body.photo) {
      await db.insert(schema.photoCandidates).values({
        userId: user.id,
        personId: id,
        photoUrl: cur[0].avatarPhoto,
        sourceLabel: 'previous',
      });
    }
    patch.avatarPhoto = body.photo;
  }
  if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
    patch.avatarColor = body.color;
  }
  if (body.spec !== undefined) {
    // sanitize: only known building-block keys with string values
    const allowed = ['skin', 'hairStyle', 'hairTexture', 'hairColor', 'fringe', 'glasses', 'glassesColor', 'beard'];
    if (body.spec === null) {
      patch.avatarSpec = null;
    } else if (typeof body.spec === 'object') {
      const clean: Record<string, string> = {};
      for (const k of allowed) {
        const v = (body.spec as Record<string, unknown>)[k];
        if (typeof v === 'string' && v) clean[k] = v;
      }
      patch.avatarSpec = clean;
    }
  }

  await db.update(schema.people).set(patch).where(eq(schema.people.id, id));
  return Response.json({ ok: true });
}
