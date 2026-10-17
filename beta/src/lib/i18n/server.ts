import { cookies } from 'next/headers';
import { normalizeLang, type Lang } from './dict';

/** Resolve the UI language: logged-in user setting, else lang cookie, else 'en'. */
export async function getLang(userLanguage?: string | null): Promise<Lang> {
  if (userLanguage) return normalizeLang(userLanguage);
  const jar = await cookies();
  return normalizeLang(jar.get('lang')?.value);
}
