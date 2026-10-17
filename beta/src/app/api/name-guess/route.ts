import { requireUser } from '@/lib/auth';
import { guessNames } from '@/lib/organizer';

/** POST {clues}: name guessing from partial memory. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  let body: { clues?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const clues = (body.clues || '').trim();
  if (!clues) return Response.json({ error: 'empty_text' }, { status: 400 });
  const result = await guessNames({ userId: user.id, clues });
  return Response.json(result);
}
