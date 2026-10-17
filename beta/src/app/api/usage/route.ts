import { requireUser } from '@/lib/auth';
import { getUsageSummary } from '@/lib/usage';

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  // All API spend comes from the owner's key, so show the account-wide total.
  const summary = await getUsageSummary();
  return Response.json(summary);
}
