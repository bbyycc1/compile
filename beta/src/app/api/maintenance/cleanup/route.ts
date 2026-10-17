import { requireUser } from '@/lib/auth';
import { cleanupContacts } from '@/lib/organizer';

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await cleanupContacts(user.id);
  return Response.json(result);
}
