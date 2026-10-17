import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { retryResearch, runningJobs, photoJobOutcome } from '@/lib/research';

type Ctx = { params: Promise<{ id: string }> };

async function owned(userId: string, personId: string) {
  const rows = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), eq(schema.people.id, personId)))
    .limit(1);
  return rows.length > 0;
}

/** GET: brief + research job status for a person. */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!(await owned(user.id, id))) return Response.json({ error: 'not_found' }, { status: 404 });

  const [brief] = await db
    .select()
    .from(schema.backgroundBriefs)
    .where(and(eq(schema.backgroundBriefs.userId, user.id), eq(schema.backgroundBriefs.personId, id)))
    .limit(1);
  const jobs = await runningJobs(user.id, id);
  const photoOutcome = await photoJobOutcome(user.id, id);
  return Response.json({
    brief: brief
      ? {
          roleLine: brief.roleLine,
          prevRoles: brief.prevRoles,
          education: brief.education,
          notableFact: brief.notableFact,
          sources: (() => {
            try {
              return JSON.parse(brief.sources || '[]');
            } catch {
              return [];
            }
          })(),
          confidence: brief.confidence,
        }
      : null,
    lookingUp: jobs,
    /** 'no_photo' | 'failed' | null — outcome of the last finished photo lookup */
    photoOutcome,
  });
}

/** POST: (re)run background research for this person. */
export async function POST(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!(await owned(user.id, id))) return Response.json({ error: 'not_found' }, { status: 404 });
  retryResearch(user.id, id);
  return Response.json({ ok: true, status: 'researching' });
}
