import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { getAnthropic, resolveModel, bestMatch } from './organizer';
import { recordUsage } from './usage';

type Track = { userId: string; feature: string };

// ---------------------------------------------------------------------------
// Public-web research: background briefs, photos, event prospects.
// All slow work runs in the background; research_jobs rows drive the
// "looking up..." avatar state. Never throws to callers (jobs record failure).
// ---------------------------------------------------------------------------

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI returned no JSON.');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

async function aiWithSearch(system: string, userText: string, maxUses: number | null = 6, track?: Track): Promise<string> {
  const client = await getAnthropic();
  const model = await resolveModel();
  const msg = await client.messages.create({
    model,
    max_tokens: 2000,
    system,
    tools: maxUses === null ? undefined : [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
    messages: [{ role: 'user', content: userText }],
  });
  const u = msg.usage;
  if (track && u) void recordUsage(track.userId, track.feature, model, u.input_tokens ?? 0, u.output_tokens ?? 0);
  const texts: string[] = [];
  for (const b of msg.content) {
    if (b.type === 'text') texts.push(b.text);
  }
  return texts.join('\n');
}

async function aiJson<T>(system: string, userText: string, maxUses: number | null = 6, track?: Track): Promise<T> {
  return parseJson<T>(await aiWithSearch(system, userText, maxUses, track));
}

// ---------------------------------------------------------------------------
// Light opt-in research (user taps "Research"): 1-2 web searches max.
// Short brief (role + company, one-line context) + photo on confident match.
// ---------------------------------------------------------------------------

type LightAI = {
  confident: boolean;
  role_line?: string;
  context?: string;
  sources?: { title?: string; url?: string }[];
  photo_url?: string | null;
  photo_alternates?: string[];
};

const LIGHT_SYSTEM = `You do a quick web lookup for a personal networking app. Use at most 1-2 searches.

CONFIDENCE RULES — strict:
- Report findings ONLY when you are VERY SURE you found the right person.
- Small organization: first name + organization may be enough.
- Large organization: require 2-3 corroborating details (full name, role, organization).
- When uncertain, return {"confident": false}. Never guess.
- Never use LinkedIn (login-walled). Prefer organization pages, faculty pages, personal sites, public event pages.

When confident, return ONLY JSON:
{"confident": true,
 "role_line": "current role + company, e.g. 'Product Designer at Figma'",
 "context": "one line of useful context",
 "sources": [{"title": "...", "url": "..."}],
 "photo_url": "direct portrait image URL from their org page when found",
 "photo_alternates": ["1-2 other portrait URLs of the same person"]}

Keep it short. No past roles, no education history.`;

/**
 * User-initiated light research. Returns { found } — callers show a
 * dismissible "couldn't find much" notice when false.
 */
export async function researchLight(userId: string, personId: string): Promise<{ found: boolean }> {
  const iden = await loadIdentity(userId, personId);
  if (!iden) return { found: false };
  await setJob(userId, personId, 'brief', 'running');
  await setJob(userId, personId, 'photo', 'running');
  try {
    const context = [iden.roleTitle, iden.company, iden.headline].filter(Boolean).join(' · ');
    const r = await aiJson<LightAI>(
      LIGHT_SYSTEM,
      `Quick lookup: ${iden.name}${context ? ` — known: ${context}` : ''}.`,
      2,
      { userId, feature: 'research' },
    );
    if (!r.confident) {
      await setJob(userId, personId, 'brief', 'done', 'uncertain');
      await setJob(userId, personId, 'photo', 'done', 'uncertain');
      return { found: false };
    }
    const sources = (r.sources ?? [])
      .filter((s) => s.url)
      .slice(0, 2)
      .map((s) => ({ title: s.title || s.url!, url: s.url! }));
    await db
      .insert(schema.backgroundBriefs)
      .values({
        userId,
        personId,
        roleLine: r.role_line?.trim() || null,
        prevRoles: null,
        education: null,
        notableFact: r.context?.trim() || null,
        sources: JSON.stringify(sources),
        confidence: 'confident',
      })
      .onConflictDoUpdate({
        target: [schema.backgroundBriefs.userId, schema.backgroundBriefs.personId],
        set: {
          roleLine: r.role_line?.trim() || null,
          prevRoles: null,
          education: null,
          notableFact: r.context?.trim() || null,
          sources: JSON.stringify(sources),
          confidence: 'confident',
          updatedAt: new Date(),
        },
      });
    await setJob(userId, personId, 'brief', 'done');

    // photo on confident match only
    const photoUrls = [r.photo_url, ...(r.photo_alternates ?? [])].filter(Boolean) as string[];
    let saved = false;
    for (const url of photoUrls) {
      const dataUrl = await downloadPhoto(url);
      if (dataUrl) {
        const cur = await loadIdentity(userId, personId);
        if (!cur?.avatarPhoto) {
          await db.update(schema.people).set({ avatarPhoto: dataUrl, updatedAt: new Date() }).where(eq(schema.people.id, personId));
        }
        saved = true;
        break;
      }
    }
    // keep alternates warm for "find another photo" (no extra AI — urls already in hand)
    if (photoUrls.length > 1) {
      await warmPhotoCache(userId, personId, photoUrls.slice(1));
    }
    await setJob(userId, personId, 'photo', 'done', saved ? undefined : 'no_photo_found');
    return { found: true };
  } catch (err) {
    await setJob(userId, personId, 'brief', 'failed', err instanceof Error ? err.message : 'failed');
    await setJob(userId, personId, 'photo', 'failed');
    return { found: false };
  }
}

async function setJob(userId: string, personId: string, kind: 'brief' | 'photo', status: 'running' | 'done' | 'failed', detail?: string) {
  const existing = await db
    .select({ id: schema.researchJobs.id })
    .from(schema.researchJobs)
    .where(
      and(
        eq(schema.researchJobs.userId, userId),
        eq(schema.researchJobs.personId, personId),
        eq(schema.researchJobs.kind, kind),
      ),
    )
    .limit(1);
  if (existing.length) {
    await db
      .update(schema.researchJobs)
      .set({ status, detail: detail ?? null, updatedAt: new Date() })
      .where(eq(schema.researchJobs.id, existing[0].id));
  } else {
    await db.insert(schema.researchJobs).values({ userId, personId, kind, status, detail: detail ?? null });
  }
}

export async function runningJobs(userId: string, personId: string): Promise<{ brief: boolean; photo: boolean }> {
  const rows = await db
    .select({ kind: schema.researchJobs.kind })
    .from(schema.researchJobs)
    .where(
      and(
        eq(schema.researchJobs.userId, userId),
        eq(schema.researchJobs.personId, personId),
        eq(schema.researchJobs.status, 'running'),
      ),
    );
  return {
    brief: rows.some((r) => r.kind === 'brief'),
    photo: rows.some((r) => r.kind === 'photo'),
  };
}

/**
 * Outcome of the most recent photo job (for the dismissible "no photo" notice).
 * Returns 'no_photo' when the last lookup finished without a verified photo,
 * 'failed' when it errored, null when still running or never run.
 */
export async function photoJobOutcome(
  userId: string,
  personId: string,
): Promise<'no_photo' | 'failed' | null> {
  const rows = await db
    .select({ status: schema.researchJobs.status, detail: schema.researchJobs.detail })
    .from(schema.researchJobs)
    .where(
      and(
        eq(schema.researchJobs.userId, userId),
        eq(schema.researchJobs.personId, personId),
        eq(schema.researchJobs.kind, 'photo'),
      ),
    )
    .orderBy(desc(schema.researchJobs.updatedAt))
    .limit(1);
  const job = rows[0];
  if (!job || job.status === 'running') return null;
  if (job.status === 'failed') return 'failed';
  if (job.detail === 'no_photo_found') return 'no_photo';
  return null;
}

/** Previous photos for the revert picker (newest first). */
export async function listPreviousPhotos(
  userId: string,
  personId: string,
): Promise<{ id: string; photoUrl: string; createdAt: Date }[]> {
  return db
    .select({
      id: schema.photoCandidates.id,
      photoUrl: schema.photoCandidates.photoUrl,
      createdAt: schema.photoCandidates.createdAt,
    })
    .from(schema.photoCandidates)
    .where(
      and(
        eq(schema.photoCandidates.userId, userId),
        eq(schema.photoCandidates.personId, personId),
        eq(schema.photoCandidates.sourceLabel, 'previous'),
      ),
    )
    .orderBy(desc(schema.photoCandidates.createdAt))
    .limit(6);
}

/**
 * Revert to a previous photo: swap the current avatar with the chosen
 * previous one (the current one becomes a "previous" so you can toggle back).
 */
export async function revertToPreviousPhoto(
  userId: string,
  personId: string,
  candidateId?: string,
): Promise<{ ok: true } | { ok: false; reason: 'none' | 'not_found' }> {
  const iden = await loadIdentity(userId, personId);
  if (!iden) return { ok: false, reason: 'not_found' };
  const prev = await listPreviousPhotos(userId, personId);
  const cand = candidateId ? prev.find((p) => p.id === candidateId) : prev[0];
  if (!cand) return { ok: false, reason: 'none' };
  if (iden.avatarPhoto && iden.avatarPhoto !== cand.photoUrl) {
    await db.insert(schema.photoCandidates).values({
      userId,
      personId,
      photoUrl: iden.avatarPhoto,
      sourceLabel: 'previous',
    });
  }
  await db
    .update(schema.people)
    .set({ avatarPhoto: cand.photoUrl, updatedAt: new Date() })
    .where(eq(schema.people.id, personId));
  await db.delete(schema.photoCandidates).where(eq(schema.photoCandidates.id, cand.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

type Identity = {
  id: string;
  name: string;
  company: string | null;
  roleTitle: string | null;
  headline: string | null;
  avatarPhoto: string | null;
};

async function loadIdentity(userId: string, personId: string): Promise<Identity | null> {
  const rows = await db
    .select({
      id: schema.people.id,
      name: schema.people.name,
      company: schema.people.company,
      roleTitle: schema.people.roleTitle,
      headline: schema.people.headline,
      avatarPhoto: schema.people.avatarPhoto,
    })
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), eq(schema.people.id, personId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Name variants for dictation-tolerant search ("Jorge Otero-Millan" → "Jorge O Millan"). */
function nameVariants(name: string): string[] {
  const out = new Set<string>([name]);
  const noHyphen = name.replace(/-/g, ' ');
  out.add(noHyphen);
  // "Jorge Otero-Millan" → "Jorge O Millan" (middle initial from second token)
  const parts = noHyphen.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) out.add(`${parts[0]} ${parts[1][0]} ${parts.slice(2).join(' ')}`);
  if (parts.length >= 2) out.add(`${parts[0]} ${parts[parts.length - 1]}`);
  return [...out];
}

// ---------------------------------------------------------------------------
// Photo download (data URL, size-capped)
// ---------------------------------------------------------------------------

const PHOTO_TIMEOUT_MS = 9000;
const MAX_PHOTO_BYTES = 900 * 1024;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

/** Download an image URL → data URL (capped). Returns null when unusable. */
export async function downloadPhoto(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, PHOTO_TIMEOUT_MS);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
    const mime = ct.split(';')[0].trim() || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Extract og:image from a page (org/faculty pages usually have one). */
async function ogImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(pageUrl, PHOTO_TIMEOUT_MS);
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return null;
    const src = m[1];
    return src.startsWith('http') ? src : new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Photo lookup: dedicated retry, warm cache, fast swap
// ---------------------------------------------------------------------------

const PHOTO_SYSTEM = `Find a portrait photo of the described person using web search. Prefer their official organization/faculty page. Never use LinkedIn. Return ONLY JSON: {"photo_url": "direct image URL", "alternates": ["..."], "source": "page title"}. Only real photos of the right person — when unsure, return {"photo_url": null}.`;

async function lookupPhotoUrls(iden: Identity, userId?: string): Promise<{ url: string; alternates: string[] }> {
  const context = [iden.roleTitle, iden.company].filter(Boolean).join(' at ');
  const track = userId ? { userId, feature: 'photo' } : undefined;
  for (const variant of nameVariants(iden.name)) {
    try {
      const r = await aiJson<{ photo_url?: string | null; alternates?: string[]; source?: string }>(
        PHOTO_SYSTEM,
        `Portrait photo of ${variant}${context ? `, ${context}` : ''}.`,
        5,
        track,
      );
      if (r.photo_url) return { url: r.photo_url, alternates: r.alternates ?? [] };
    } catch {
      // try next variant
    }
  }
  return { url: '', alternates: [] };
}

/** Fill the alternate-photo cache (called when a verified profile opens). */
export async function warmPhotoCache(userId: string, personId: string, knownUrls?: string[]): Promise<void> {
  const iden = await loadIdentity(userId, personId);
  if (!iden) return;
  let urls: string[] = (knownUrls ?? []).filter(Boolean);
  if (!urls.length) {
    try {
      const r = await lookupPhotoUrls(iden, userId);
      urls = [r.url, ...r.alternates].filter(Boolean);
    } catch {
      urls = [];
    }
  }
  // also try og:image from the brief's sources
  const [brief] = await db
    .select({ sources: schema.backgroundBriefs.sources })
    .from(schema.backgroundBriefs)
    .where(and(eq(schema.backgroundBriefs.userId, userId), eq(schema.backgroundBriefs.personId, personId)))
    .limit(1);
  if (brief?.sources) {
    try {
      const srcs = JSON.parse(brief.sources) as { url: string }[];
      for (const s of srcs.slice(0, 2)) {
        const og = await ogImage(s.url);
        if (og) urls.push(og);
      }
    } catch {
      // ignore
    }
  }
  const seen = new Set<string>();
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (url === iden.avatarPhoto) continue;
    const dataUrl = url.startsWith('data:') ? url : await downloadPhoto(url);
    if (!dataUrl || dataUrl === iden.avatarPhoto) continue;
    await db.insert(schema.photoCandidates).values({ userId, personId, photoUrl: dataUrl, sourceLabel: 'web' });
    if (seen.size >= 4) break;
  }
}

/**
 * "Find another photo": instant swap from the warm cache when available,
 * otherwise a bounded fresh lookup. Never blocks long — callers show progress.
 */
export async function swapNextPhoto(
  userId: string,
  personId: string,
): Promise<{ ok: true; photoUrl: string } | { ok: false; status: 'looking' | 'none' }> {
  const iden = await loadIdentity(userId, personId);
  if (!iden) return { ok: false, status: 'none' };
  const cands = await db
    .select()
    .from(schema.photoCandidates)
    .where(and(eq(schema.photoCandidates.userId, userId), eq(schema.photoCandidates.personId, personId)))
    .limit(10);
  for (const c of cands) {
    if (c.photoUrl && c.photoUrl !== iden.avatarPhoto) {
      await db.update(schema.people).set({ avatarPhoto: c.photoUrl, updatedAt: new Date() }).where(eq(schema.people.id, personId));
      await db.delete(schema.photoCandidates).where(eq(schema.photoCandidates.id, c.id));
      // keep the old photo as a future alternate
      if (iden.avatarPhoto) {
        await db.insert(schema.photoCandidates).values({ userId, personId, photoUrl: iden.avatarPhoto, sourceLabel: 'previous' });
      }
      // no background re-warming here — that costs API calls; the user taps
      // "Research" on the profile when they want fresh candidates
      return { ok: true, photoUrl: c.photoUrl };
    }
  }
  // cache empty → bounded fresh lookup in the background
  await setJob(userId, personId, 'photo', 'running');
  void (async () => {
    try {
      const { url, alternates } = await lookupPhotoUrls(iden, userId);
      const urls = [url, ...alternates].filter(Boolean);
      let placed: string | null = null;
      for (const u of urls) {
        const d = await downloadPhoto(u);
        if (d && d !== iden.avatarPhoto) {
          placed = d;
          break;
        }
      }
      if (placed) {
        await db.update(schema.people).set({ avatarPhoto: placed, updatedAt: new Date() }).where(eq(schema.people.id, personId));
        if (iden.avatarPhoto) {
          await db.insert(schema.photoCandidates).values({ userId, personId, photoUrl: iden.avatarPhoto, sourceLabel: 'previous' });
        }
        await setJob(userId, personId, 'photo', 'done');
      } else {
        await setJob(userId, personId, 'photo', 'done', 'no_photo_found');
      }
      void warmPhotoCache(userId, personId, urls).catch(() => {});
    } catch (err) {
      await setJob(userId, personId, 'photo', 'failed', err instanceof Error ? err.message : 'failed');
    }
  })().catch(() => {});
  return { ok: false, status: 'looking' };
}

export async function acceptSuggestion(userId: string, suggestionId: string): Promise<void> {
  const [s] = await db
    .select()
    .from(schema.relationshipSuggestions)
    .where(and(eq(schema.relationshipSuggestions.userId, userId), eq(schema.relationshipSuggestions.id, suggestionId)))
    .limit(1);
  if (!s || s.status !== 'pending') return;
  const [person] = await db.select().from(schema.people).where(eq(schema.people.id, s.personId)).limit(1);
  const [related] = s.relatedPersonId
    ? await db.select().from(schema.people).where(eq(schema.people.id, s.relatedPersonId)).limit(1)
    : [];
  const addConn = (cur: string | null, addition: string) =>
    cur && cur.includes(addition) ? cur : [cur, addition].filter(Boolean).join('; ');
  if (person && related) {
    await db
      .update(schema.people)
      .set({ mutualConnections: addConn(person.mutualConnections, `Works with ${related.name}`), updatedAt: new Date() })
      .where(eq(schema.people.id, person.id));
    await db
      .update(schema.people)
      .set({ mutualConnections: addConn(related.mutualConnections, `Works with ${person.name}`), updatedAt: new Date() })
      .where(eq(schema.people.id, related.id));
    // PI/advisor implication: "Mark her as your PI too?"
    const m = s.message.match(/Mark .* as your (.+) too\?/);
    if (m && person) {
      await db
        .update(schema.people)
        .set({ headline: `${m[1]} — via ${related.name}`, updatedAt: new Date() })
        .where(eq(schema.people.id, person.id));
    }
  } else if (person && s.relatedName) {
    await db
      .update(schema.people)
      .set({ mutualConnections: addConn(person.mutualConnections, `Works with ${s.relatedName}`), updatedAt: new Date() })
      .where(eq(schema.people.id, person.id));
  }
  await db.update(schema.relationshipSuggestions).set({ status: 'accepted' }).where(eq(schema.relationshipSuggestions.id, s.id));
}

export async function dismissSuggestion(userId: string, suggestionId: string): Promise<void> {
  await db
    .update(schema.relationshipSuggestions)
    .set({ status: 'dismissed' })
    .where(and(eq(schema.relationshipSuggestions.userId, userId), eq(schema.relationshipSuggestions.id, suggestionId)));
}

// ---------------------------------------------------------------------------
// Event prospect research ("I'm going to X tomorrow, only find engineers")
// ---------------------------------------------------------------------------

export type EventResearchResult =
  | { ok: true; eventId: string; title: string; prospectCount: number }
  | { ok: false; needLink: true; eventHint: string };

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30000);
}

const EVENT_SYSTEM = `You read a public event page and extract the people worth knowing. Return ONLY JSON:
{"event_title": "...", "people": [{"name": "...", "headline": "role at org", "company": "...", "role": "...", "reason": "why they matter for the filter"}]}
Apply the attendee filter strictly (e.g. "only engineers" → only engineering roles). Speakers, hosts, and key attendees first. Skip people with no identifiable role. Empty people array when nothing matches.`;

export async function researchEvent(
  userId: string,
  eventHint: string,
  filters: string | null,
  sourceUrl?: string,
): Promise<EventResearchResult> {
  // 1) find the event page
  let pageUrl = sourceUrl?.trim() || '';
  let pageText = '';
  if (!pageUrl) {
    try {
      const found = await aiJson<{ url?: string; title?: string }>(
        `You find public event pages. Return ONLY JSON: {"url": "...", "title": "..."}. If you cannot find a public page for the event, return {"url": null}. Prefer luma, eventbrite, or the organizer's own site.`,
        `Public event page for: "${eventHint}".`,
        4,
        { userId, feature: 'event_research' },
      );
      if (found.url) pageUrl = found.url;
    } catch {
      // fall through
    }
  }
  if (!pageUrl) return { ok: false, needLink: true, eventHint };
  try {
    const res = await fetchWithTimeout(pageUrl, 12000);
    if (!res.ok) throw new Error('fetch failed');
    pageText = stripHtml(await res.text());
  } catch {
    return { ok: false, needLink: true, eventHint };
  }
  if (!pageText || pageText.length < 300) return { ok: false, needLink: true, eventHint };

  // 2) extract people
  let extracted: { event_title?: string; people?: { name?: string; headline?: string; company?: string; role?: string; reason?: string }[] };
  try {
    extracted = await aiJson(
      EVENT_SYSTEM,
      `Event hint: "${eventHint}".${filters ? ` Attendee filter: ${filters}.` : ''}\n\nPAGE TEXT:\n${pageText}`,
      null,
      { userId, feature: 'event_research' },
    );
  } catch {
    return { ok: false, needLink: true, eventHint };
  }
  const people = (extracted.people ?? []).filter((p) => p.name && p.name.trim()).slice(0, 30);
  const [ev] = await db
    .insert(schema.prospectEvents)
    .values({
      userId,
      title: extracted.event_title?.trim() || eventHint,
      sourceUrl: pageUrl,
      filters,
      note: filters ? `Filter: ${filters}` : null,
    })
    .returning({ id: schema.prospectEvents.id, title: schema.prospectEvents.title });
  for (const p of people) {
    await db.insert(schema.prospects).values({
      userId,
      eventId: ev.id,
      name: p.name!.trim(),
      headline: p.headline?.trim() || null,
      company: p.company?.trim() || null,
      roleTitle: p.role?.trim() || null,
      reason: p.reason?.trim() || null,
      status: 'prospect',
    });
  }
  return { ok: true, eventId: ev.id, title: ev.title, prospectCount: people.length };
}

/** "I met them": convert a prospect into a real contact with an encounter. */
export async function convertProspect(userId: string, prospectId: string): Promise<string | null> {
  const [p] = await db
    .select()
    .from(schema.prospects)
    .where(and(eq(schema.prospects.userId, userId), eq(schema.prospects.id, prospectId)))
    .limit(1);
  if (!p || p.status === 'met') return p?.personId ?? null;
  const [ev] = await db.select().from(schema.prospectEvents).where(eq(schema.prospectEvents.id, p.eventId)).limit(1);
  // reuse an existing person when the name matches (never duplicate)
  const existing = await db
    .select({ id: schema.people.id, name: schema.people.name })
    .from(schema.people)
    .where(eq(schema.people.userId, userId))
    .limit(500);
  const dupe = bestMatch(p.name, existing, 0.85);
  let personId: string;
  if (dupe) {
    personId = dupe.item.id;
  } else {
    const [row] = await db
      .insert(schema.people)
      .values({
        userId,
        name: p.name,
        headline: p.headline,
        company: p.company,
        roleTitle: p.roleTitle,
        summary: p.reason,
      })
      .returning({ id: schema.people.id });
    personId = row.id;
  }
  const [enc] = await db
    .insert(schema.encounters)
    .values({
      userId,
      personId,
      summary: `Met at ${ev?.title ?? 'event'}${p.reason ? ` — ${p.reason}` : ''}.`,
      originalNote: `Converted from prospect (${ev?.title ?? 'event research'}).`,
    })
    .returning({ id: schema.encounters.id });
  void enc;
  await db.update(schema.prospects).set({ status: 'met', personId }).where(eq(schema.prospects.id, p.id));
  // no automatic research — the user taps "Research" on the profile if they want it
  return personId;
}

// ---------------------------------------------------------------------------
// Manual "Research" for one person — user-initiated, very light (1-2 searches)
// ---------------------------------------------------------------------------

export function retryResearch(userId: string, personId: string): void {
  void (async () => {
    await db
      .delete(schema.backgroundBriefs)
      .where(and(eq(schema.backgroundBriefs.userId, userId), eq(schema.backgroundBriefs.personId, personId)));
    await researchLight(userId, personId);
  })().catch(() => {});
}
