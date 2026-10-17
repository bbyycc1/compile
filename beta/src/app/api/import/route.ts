import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/**
 * Import a prototype export file (the getstate `data` shape) into the current
 * user's account. Prototype IDs are integers; the beta uses UUIDs, so every
 * reference is remapped. People whose name already exists (case-insensitive)
 * are skipped along with their dependent records.
 */

// ---------- prototype shapes ----------
type ProtoPerson = {
  id: number; name: string; headline?: string | null; profileSummary?: string | null;
  company?: string | null; role?: string | null; industry?: string | null;
  introHook?: string | null; likelyPlaces?: string | null; mutualConnections?: string | null;
  helpMe?: string | null; helpThem?: string | null; contactNotes?: string | null;
  conversation?: string | null; appearance?: string | null; createdAt?: string | null;
};
type ProtoEncounter = {
  id: number; personId: number; eventId?: number | null; notes?: string | null;
  rawDump?: string | null; createdAt?: string | null;
};
type ProtoEvent = { id: number; name: string; venue?: string | null; createdAt?: string | null };
type ProtoFollowUp = {
  id: number; personId: number; text: string; completed?: boolean | null; createdAt?: string | null;
};
type ProtoBrief = {
  personId: number; currentRole?: string | null; previousRoles?: string[] | null;
  education?: string | null; notableFact?: string | null;
  sources?: { title: string; url: string }[] | null; status?: string | null; searchedAt?: string | null;
};
type ProtoTag = { id: number; name: string; color?: string | null };
type ProtoPersonTag = { personId: number; tagId: number; isPrimary?: boolean | null };
type ProtoGlossary = { alias: string; canonical: string; category?: string | null };
type ProtoSuggestion = {
  personId: number; relatedPersonId?: number | null; question?: string | null;
  status?: string | null;
};
type ProtoExport = {
  people?: ProtoPerson[]; encounters?: ProtoEncounter[]; events?: ProtoEvent[];
  followUps?: ProtoFollowUp[]; backgroundBriefs?: ProtoBrief[]; tags?: ProtoTag[];
  personTags?: ProtoPersonTag[]; glossary?: ProtoGlossary[];
  relationshipSuggestions?: ProtoSuggestion[];
};

function asDate(v: string | null | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
const str = (v: string | null | undefined): string | null =>
  v == null || v === '' ? null : v;

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  let body: ProtoExport;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (!body || !Array.isArray(body.people)) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const counts = {
    people: 0, occasions: 0, encounters: 0, followUps: 0,
    backgroundBriefs: 0, tags: 0, personTags: 0, glossary: 0,
    relationshipSuggestions: 0,
  };
  const skipped: string[] = [];

  // existing names/occasions/tags/glossary for dedup
  const [existingPeople, existingOccasions, existingTags, existingGlossary] = await Promise.all([
    db.select({ name: schema.people.name }).from(schema.people).where(eq(schema.people.userId, user.id)),
    db.select({ id: schema.occasions.id, name: schema.occasions.name }).from(schema.occasions).where(eq(schema.occasions.userId, user.id)),
    db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.userId, user.id)),
    db.select({ alias: schema.glossary.alias }).from(schema.glossary).where(eq(schema.glossary.userId, user.id)),
  ]);
  const personNames = new Set(existingPeople.map((p) => p.name.toLowerCase()));
  const occasionByName = new Map(existingOccasions.map((o) => [o.name.toLowerCase(), o.id]));
  const tagByName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.id]));
  const glossaryAliases = new Set(existingGlossary.map((g) => g.alias.toLowerCase()));

  const personIdMap = new Map<number, string>(); // proto int id -> beta uuid
  const skippedPersonIds = new Set<number>();
  const occasionIdMap = new Map<number, string>();
  const tagIdMap = new Map<number, string>();

  // ---- people ----
  for (const p of body.people) {
    if (p == null || typeof p.id !== 'number' || !p.name) continue;
    const nameKey = p.name.toLowerCase();
    if (personNames.has(nameKey)) {
      skipped.push(p.name);
      skippedPersonIds.add(p.id);
      continue;
    }
    personNames.add(nameKey);
    const [row] = await db
      .insert(schema.people)
      .values({
        userId: user.id,
        name: p.name,
        headline: str(p.headline),
        summary: str(p.profileSummary),
        company: str(p.company),
        roleTitle: str(p.role),
        industry: str(p.industry),
        introHook: str(p.introHook),
        mutualConnections: str(p.mutualConnections),
        likelyToMeetAgain: str(p.likelyPlaces),
        theyHelpMeWith: str(p.helpMe),
        iOfferThem: str(p.helpThem),
        appearance: str(p.appearance),
        contactNotes: str(p.contactNotes),
        conversation: str(p.conversation),
        // photoUrl intentionally skipped: prototype ./blobs/... paths don't resolve in the beta
        avatarPhoto: null,
        createdAt: asDate(p.createdAt),
        updatedAt: asDate(p.createdAt),
      })
      .returning({ id: schema.people.id });
    personIdMap.set(p.id, row.id);
    counts.people++;
  }

  // name lookup for relationship suggestions (proto people, including skipped ones)
  const protoNameById = new Map((body.people || []).map((p) => [p.id, p.name]));

  // ---- events -> occasions (reuse same-name occasions) ----
  for (const e of body.events || []) {
    if (e == null || typeof e.id !== 'number' || !e.name) continue;
    const key = e.name.toLowerCase();
    const existingId = occasionByName.get(key);
    if (existingId) {
      occasionIdMap.set(e.id, existingId);
      continue;
    }
    const [row] = await db
      .insert(schema.occasions)
      .values({
        userId: user.id,
        name: e.name,
        locationDetail: str(e.venue),
        createdAt: asDate(e.createdAt),
      })
      .returning({ id: schema.occasions.id });
    occasionByName.set(key, row.id);
    occasionIdMap.set(e.id, row.id);
    counts.occasions++;
  }

  // ---- tags (reuse same-name tags) ----
  for (const t of body.tags || []) {
    if (t == null || typeof t.id !== 'number' || !t.name) continue;
    const key = t.name.toLowerCase();
    const existingId = tagByName.get(key);
    if (existingId) {
      tagIdMap.set(t.id, existingId);
      continue;
    }
    const [row] = await db
      .insert(schema.tags)
      .values({ userId: user.id, name: t.name, color: str(t.color) })
      .returning({ id: schema.tags.id });
    tagByName.set(key, row.id);
    tagIdMap.set(t.id, row.id);
    counts.tags++;
  }

  // ---- encounters ----
  for (const e of body.encounters || []) {
    if (e == null) continue;
    const personId = personIdMap.get(e.personId);
    if (!personId) continue; // skipped or unknown person
    await db.insert(schema.encounters).values({
      userId: user.id,
      personId,
      occasionId: e.eventId != null ? occasionIdMap.get(e.eventId) ?? null : null,
      summary: e.notes || '(no summary)',
      originalNote: str(e.rawDump),
      createdAt: asDate(e.createdAt),
    });
    counts.encounters++;
  }

  // ---- follow-ups ----
  for (const f of body.followUps || []) {
    if (f == null || !f.text) continue;
    const personId = personIdMap.get(f.personId);
    if (!personId) continue;
    await db.insert(schema.followUps).values({
      userId: user.id,
      personId,
      text: f.text,
      done: !!f.completed,
      createdAt: asDate(f.createdAt),
    });
    counts.followUps++;
  }

  // ---- background briefs ----
  for (const b of body.backgroundBriefs || []) {
    if (b == null) continue;
    const personId = personIdMap.get(b.personId);
    if (!personId) continue;
    await db.insert(schema.backgroundBriefs).values({
      userId: user.id,
      personId,
      roleLine: str(b.currentRole),
      prevRoles: b.previousRoles && b.previousRoles.length ? b.previousRoles.join('\n') : null,
      education: str(b.education),
      notableFact: str(b.notableFact),
      sources: b.sources && b.sources.length ? JSON.stringify(b.sources) : null,
      confidence: b.status === 'matched' ? 'confident' : 'uncertain',
      createdAt: asDate(b.searchedAt),
      updatedAt: asDate(b.searchedAt),
    });
    counts.backgroundBriefs++;
  }

  // ---- person-tag links ----
  for (const pt of body.personTags || []) {
    if (pt == null) continue;
    const personId = personIdMap.get(pt.personId);
    const tagId = tagIdMap.get(pt.tagId);
    if (!personId || !tagId) continue;
    try {
      await db.insert(schema.personTags).values({ personId, tagId });
      counts.personTags++;
    } catch {
      // duplicate link — ignore
    }
  }

  // ---- glossary ----
  for (const g of body.glossary || []) {
    if (g == null || !g.alias || !g.canonical) continue;
    const key = g.alias.toLowerCase();
    if (glossaryAliases.has(key)) continue;
    glossaryAliases.add(key);
    try {
      await db.insert(schema.glossary).values({
        userId: user.id,
        alias: g.alias,
        canonical: g.canonical,
        kind: g.category || 'entity',
      });
      counts.glossary++;
    } catch {
      // unique-violation race — ignore
    }
  }

  // ---- relationship suggestions ----
  for (const s of body.relationshipSuggestions || []) {
    if (s == null) continue;
    const personId = personIdMap.get(s.personId);
    if (!personId) continue;
    let relatedPersonId: string | null = null;
    let relatedName: string | null = null;
    if (s.relatedPersonId != null) {
      relatedPersonId = personIdMap.get(s.relatedPersonId) ?? null;
      if (!relatedPersonId) continue; // related person was skipped
      relatedName = protoNameById.get(s.relatedPersonId) ?? null;
    }
    const status =
      s.status === 'confirmed' ? 'accepted' : s.status === 'dismissed' ? 'dismissed' : 'pending';
    await db.insert(schema.relationshipSuggestions).values({
      userId: user.id,
      personId,
      relatedPersonId,
      relatedName,
      relation: 'works_with',
      message: s.question || '(no question)',
      status,
    });
    counts.relationshipSuggestions++;
  }

  return Response.json({ ok: true, imported: counts, skipped });
}
