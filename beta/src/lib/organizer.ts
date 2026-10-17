import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { recordUsage } from './usage';
import type { GlossaryEntry } from './db/schema';

// ---------------------------------------------------------------------------
// Entity normalization & fuzzy matching (deterministic, no AI needed)
// ---------------------------------------------------------------------------

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normalizeEntity(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) d[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return d[n];
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeEntity(s).split(' ').filter(Boolean));
}

function tokenSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  // abbreviation: single letter matching the other's first letter ("e" ~ "entrepreneurship")
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  return false;
}

/**
 * Similarity in [0,1] between two entity names. Handles case, punctuation,
 * word order, partial names, abbreviations ("Haas E-Hub" ~ "Haas Entrepreneurship Hub"),
 * and small typos.
 */
export function entitySimilarity(a: string, b: string): number {
  const na = normalizeEntity(a);
  const nb = normalizeEntity(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // containment (one is the other plus context): "haas" in "haas e hub"
  if (na.length >= 3 && nb.length >= 3) {
    if (nb.includes(na) || na.includes(nb)) {
      const longer = Math.max(na.length, nb.length);
      const shorter = Math.min(na.length, nb.length);
      return 0.75 + 0.25 * (shorter / longer);
    }
  }
  const ta = [...tokenSet(a)];
  const tb = [...tokenSet(b)];
  if (ta.length && tb.length) {
    let inter = 0;
    for (const x of ta) if (tb.some((y) => tokenSimilar(x, y))) inter++;
    const jaccard = inter / (ta.length + tb.length - inter);
    if (jaccard >= 0.5) return Math.max(0.72, jaccard);
  }
  const maxLen = Math.max(na.length, nb.length);
  const lev = 1 - levenshtein(na, nb) / maxLen;
  return lev;
}

export function bestMatch<T extends { id: string; name: string }>(
  input: string,
  candidates: T[],
  threshold = 0.72,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const c of candidates) {
    const score = entitySimilarity(input, c.name);
    if (score >= threshold && (!best || score > best.score)) best = { item: c, score };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Time: the user lives in America/Los_Angeles; relative dates resolve there.
// ---------------------------------------------------------------------------

/** Current date + time in America/Los_Angeles (for relative-date resolution). */
export function laNow(at?: Date): { date: string; time: string; weekday: string } {
  const d = at ?? new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const tfmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const wfmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long' });
  return { date: fmt.format(d), time: tfmt.format(d), weekday: wfmt.format(d) };
}

// ---------------------------------------------------------------------------
// Glossary: remembered proper-noun corrections
// ---------------------------------------------------------------------------

/** Replace known aliases with canonical forms before the text reaches the AI. */
export function applyGlossary(text: string, entries: GlossaryEntry[]): string {
  let out = text;
  const sorted = [...entries].sort((x, y) => y.alias.length - x.alias.length);
  for (const e of sorted) {
    if (!e.alias || !e.canonical || normalizeEntity(e.alias) === normalizeEntity(e.canonical)) continue;
    const escaped = e.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // word-boundary-ish replace, case-insensitive
    const re = new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'giu');
    out = out.replace(re, e.canonical);
  }
  return out;
}

/** Remember a user correction: old name → new canonical name. */
export async function learnCorrection(
  userId: string,
  oldValue: string | null | undefined,
  newValue: string | null | undefined,
  kind: string,
): Promise<void> {
  const from = (oldValue || '').trim();
  const to = (newValue || '').trim();
  if (!from || !to) return;
  if (normalizeEntity(from) === normalizeEntity(to)) return;
  await db
    .insert(schema.glossary)
    .values({ userId, alias: from, canonical: to, kind })
    .onConflictDoUpdate({
      target: [schema.glossary.userId, schema.glossary.alias],
      set: { canonical: to, kind },
    });
}

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

let cachedModel: string | null = null;

/** Shared Anthropic client (also used by the research module). */
export async function getAnthropic(): Promise<Anthropic> {
  return getClient();
}

async function getClient(): Promise<Anthropic> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI unavailable: ANTHROPIC_API_KEY is not set.');
  return new Anthropic({ apiKey: key });
}

/** Resolve which model to use: env override, else newest Sonnet from the API. */
export async function resolveModel(): Promise<string> {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  if (cachedModel) return cachedModel;
  const client = await getClient();
  const page = await client.models.list({ limit: 50 });
  const models = page.data ?? [];
  const byDate = [...models].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const sonnet = byDate.find((m) => /sonnet/i.test(m.id));
  const chosen = sonnet?.id ?? byDate[0]?.id;
  if (!chosen) throw new Error('AI unavailable: no models returned by the API.');
  cachedModel = chosen;
  return chosen;
}

export type AICall = (system: string, userText: string, signal?: AbortSignal) => Promise<string>;

async function defaultAICall(system: string, userText: string, signal?: AbortSignal): Promise<string> {
  const client = await getClient();
  const model = await resolveModel();
  const msg = await client.messages.create(
    {
      model,
      max_tokens: 2500,
      system,
      messages: [{ role: 'user', content: userText }],
    },
    { signal },
  );
  const block = msg.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

/**
 * AICall wrapper that records token usage + estimated cost per call.
 * Use at call sites that know the userId instead of defaultAICall.
 */
export function trackedAICall(userId: string, feature: string): AICall {
  return async (system: string, userText: string, signal?: AbortSignal): Promise<string> => {
    const client = await getClient();
    const model = await resolveModel();
    const msg = await client.messages.create(
      {
        model,
        max_tokens: 2500,
        system,
        messages: [{ role: 'user', content: userText }],
      },
      { signal },
    );
    const u = msg.usage;
    if (u) void recordUsage(userId, feature, model, u.input_tokens ?? 0, u.output_tokens ?? 0);
    const block = msg.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  };
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI returned no JSON.');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/** The AI sometimes returns a boolean/number where a string was asked for. Coerce safely. */
function str(v: unknown): string | null {
  return typeof v === 'string' ? v.trim() || null : null;
}

// ---------------------------------------------------------------------------
// Optimistic capture: save the raw note instantly, organize in background
// ---------------------------------------------------------------------------

export async function savePendingCapture(
  userId: string,
  text: string,
  recentTurns: ConversationTurn[] = [],
): Promise<string> {
  const [row] = await db
    .insert(schema.pendingCaptures)
    .values({ userId, text, recentTurns })
    .returning({ id: schema.pendingCaptures.id });
  return row.id;
}

export async function getPendingCapture(
  pendingId: string,
  userId: string,
): Promise<schema.PendingCapture | null> {
  const [row] = await db
    .select()
    .from(schema.pendingCaptures)
    .where(and(eq(schema.pendingCaptures.id, pendingId), eq(schema.pendingCaptures.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function markPendingDone(pendingId: string, result: unknown): Promise<void> {
  await db
    .update(schema.pendingCaptures)
    .set({ status: 'done', result: result as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(schema.pendingCaptures.id, pendingId));
}

async function markPendingFailed(pendingId: string, error: string): Promise<void> {
  await db
    .update(schema.pendingCaptures)
    .set({ status: 'failed', error, updatedAt: new Date() })
    .where(eq(schema.pendingCaptures.id, pendingId));
}

/**
 * Run the organizer for a pending capture in the background.
 * Never throws — failures are recorded on the pending row for retry.
 */
export function organizePendingInBackground(
  pendingId: string,
  userId: string,
  text: string,
  recentTurns: ConversationTurn[] = [],
): void {
  void (async () => {
    try {
      const results = await organizeCapture({ userId, text, recentTurns });
      await markPendingDone(pendingId, results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'organizer_failed';
      await markPendingFailed(pendingId, msg);
    }
  })();
}

// ---------------------------------------------------------------------------
// Capture organizer
// ---------------------------------------------------------------------------

export type OrganizerContext = {
  people: { id: string; name: string }[];
  occasions: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  glossary: GlossaryEntry[];
  /** the user of the app — used to resolve references like "my PI" and write better summaries */
  profile: { aboutMe: string | null; facts: string[] };
};

export type PersonBlock = {
  match_person_id?: string | null;
  name?: string;
  /** true when the model is genuinely unsure about the name spelling (voice-transcription ambiguity) */
  name_uncertain?: boolean | null;
  headline?: string | null;
  profile_summary?: string | null;
  company?: string | null;
  role_title?: string | null;
  industry?: string | null;
  intro_hook?: string | null;
  mutual_connections?: string | null;
  likely_to_meet_again?: string | null;
  they_help_me_with?: string | null;
  i_offer_them?: string | null;
  appearance?: string | null;
  /** abstract avatar building blocks — only fields actually mentioned, else null */
  avatar?: {
    skin?: 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark' | null;
    hair_style?: 'bald' | 'short' | 'medium' | 'long' | 'bun' | null;
    hair_texture?: 'straight' | 'curly' | null;
    hair_color?: 'black' | 'brown' | 'blonde' | 'red' | 'gray' | 'white' | null;
    fringe?: 'none' | 'fringe' | null;
    glasses?: 'none' | 'rect' | 'round' | null;
    glasses_color?: 'black' | 'brown' | 'gold' | 'silver' | null;
    beard?: 'none' | 'short' | 'full' | null;
  } | null;
  occasion?: { match_occasion_id?: string | null; name?: string | null } | null;
  tags?: string[];
  encounter_summary?: string | null;
  follow_ups?: { text: string; due_date?: string | null }[];
};

export type ConversationTurn = {
  text: string;
  /** person names this turn mentioned/created/updated, most recent first */
  personNames: string[];
  /** assistant's reply, for conversational assistant turns (lets "fix it" follow-ups work) */
  assistantResponse?: string;
};

function buildOrganizerPrompt(ctx: OrganizerContext, today: string, nowTime: string, recentTurns: ConversationTurn[]): string {
  const peopleList =
    ctx.people.map((p) => `- ${p.id} :: ${p.name}`).join('\n') || '(none yet)';
  const occasionList =
    ctx.occasions.map((o) => `- ${o.id} :: ${o.name}`).join('\n') || '(none yet)';
  const tagList = ctx.tags.map((t) => t.name).join(', ') || '(none yet)';
  const glossaryList =
    ctx.glossary.map((g) => `- "${g.alias}" → "${g.canonical}"`).join('\n') || '(none)';
  const profileLines: string[] = [];
  if (ctx.profile.aboutMe) profileLines.push(`About me: ${ctx.profile.aboutMe}`);
  for (const f of ctx.profile.facts.slice(0, 20)) profileLines.push(`- ${f}`);
  const profileText = profileLines.length
    ? profileLines.join('\n')
    : '(nothing known yet — never ask the user for this information)';
  const convo =
    recentTurns.length
      ? recentTurns
          .slice(-6)
          .map((t, i) => `${i + 1}. "${t.text}"${t.personNames.length ? ` (about: ${t.personNames.join(', ')})` : ''}`)
          .join('\n')
      : '(none)';

  return `You are the organizer for a personal relationship-memory app. The user brain-dumps messy text (typed or voice-dictated) about people they met. Turn it into clean structured data.

RULES — follow strictly:
- Each block is about ONE person. A capture may mention several people; emit one block per person actually described.
- MATCHING: compare against EXISTING PEOPLE below. If the capture is about someone already listed (same human even if the name spelling/abbreviation differs), set match_person_id to their id and fill ONLY fields carrying NEW information (everything else null). NEVER create a duplicate person.
- ENTITY ATTRIBUTION (critical): the user is "I/me". Relationship statements describe the USER too — attribute every fact to the correct entity. "I'm his RA" means the USER is the research assistant; NEVER label the contact as an RA. "She's my PI" means SHE is the PI. "I work for her" makes HER the boss, not the user. Getting this backwards is the worst possible error.
- headline: one short line "Role at Affiliation" describing THAT person, e.g. "Professor at UC Berkeley Optometry", "Haas E-Hub coordinator". Derive from facts about THEM only. NEVER use the user's own role/job. NEVER use "Met at X" when any role or affiliation info exists. Null if truly unknown.
- profile_summary: for a NEW person, a concise 2-3 sentence profile summary. For a matched person, null (their profile already exists).
- encounter_summary (REQUIRED for every block): 2-3 sentences about THIS meeting — what happened, what was discussed, any follow-up. Never paste or lightly rephrase the raw input; write a real summary.
- VOICE: summaries are written for the user's own eyes. NEVER write "the user" — write naturally from their perspective, e.g. "Met at the Berkeley AI mixer" rather than "The user met her at the Berkeley AI mixer".
- Occasion = the event/context where they met (e.g. "Haas E-Hub", "Mosaic Climbing Gym"). Set match_occasion_id when it's the same occasion as an existing one (fuzzy: abbreviations, word order, partial names all count as the same). Only give a new occasion name when truly new; null if none mentioned.
- TAGS — minimal and strict: only for REAL groups of people (occasion types, affiliations). Reuse an existing tag name whenever close. NEVER create tags for: relationship descriptors ("Tilda's friend" belongs in mutual_connections), roles, or anything speculative. Never invent a tag no person will carry. CONSISTENCY RULE: if 2+ people (in this capture or already saved) share the same affiliation, employer, school, or occasion, they MUST all carry that tag — never tag some members of a group and leave others untagged.
- mutual_connections: who they were met through / who they know ("met through Vicky", "friend of Tilda").
- Follow-ups: concrete next actions only. due_date as YYYY-MM-DD when a date is mentioned — resolve relative dates against today ${today} (${nowTime} America/Los_Angeles): "tomorrow", "yesterday", "next Wednesday", "this Friday", "in 3 days" all become concrete dates. Null when no date mentioned. Never invent follow-ups. Due dates ONLY — do not record meeting dates anywhere.
- Appearance: only concrete physical descriptors actually mentioned.
- Avatar: when physical appearance is mentioned, ALSO map it to the abstract avatar building blocks (only fields actually mentioned, else null): skin one of light/medium-light/medium/medium-dark/dark; hair_style one of bald/short/medium/long/bun; hair_texture straight/curly; hair_color one of black/brown/blonde/red/gray/white; fringe one of none/fringe (only when bangs or fringe are explicitly mentioned, default none); glasses one of none/rect/round; glasses_color one of black/brown/gold/silver; beard one of none/short/full. E.g. "long blonde hair, glasses" → {"hair_style":"long","hair_color":"blonde","glasses":"rect"}. Never guess unmentioned fields.
- Write all structured text in the SAME language as the user's input. Keep proper names as written.
- PRONOUNS: the user may say "she/he/they/him/her" meaning someone from the recent conversation below. Resolve to the most recent matching person; if two could match, still pick the most likely (the app confirms with the user).
- NAME UNCERTAINTY: if you are genuinely unsure about a person's name spelling (voice-transcription ambiguity — e.g. it could be "Vicky" or "Vickie"), set name_uncertain to true on that block and use your best guess for name. Only flag real uncertainty, never routine names. The app will ask the user to confirm.
- VOICE-DICTATION NOISE: the input was often transcribed by speech recognition and contains misheard words. Fix obvious errors using context before extracting facts — e.g. "Super Berkeley as well" from a student context almost certainly means "she goes to Berkeley as well"; "Irvin" for a physics major is likely "Irwin". Prefer the interpretation that makes sense given the person's role/affiliation. When a word is too garbled to interpret confidently, leave that detail out rather than recording nonsense.
- SELF-CORRECTIONS: if the speaker corrects themselves mid-note ("no wait", "actually it's", "I meant", "oh no"), the LATER statement wins — use only the corrected version and ignore what it replaced.
- USER FACTS (passive memory — never interrogate): if this input reveals facts about the USER themselves (their role, school, employer, affiliations, goals, activities), list them in "user_facts" as short one-line statements, e.g. "I'm Jorge's RA" → "Works as a research assistant for Jorge Otero-Millan", "I'm a student at UC Berkeley" → "Student at UC Berkeley". Only record what's explicitly stated or clearly implied. NEVER guess, NEVER ask the user for more information. [] when nothing about the user is revealed.
- Output ONLY valid JSON, no markdown fences, matching this shape:
{"blocks":[{"appearance":null,"avatar":null,"company":null,"encounter_summary":"...","follow_ups":[],"headline":null,"i_offer_them":null,"industry":null,"intro_hook":null,"likely_to_meet_again":null,"match_person_id":null,"mutual_connections":null,"name":"...","name_uncertain":false,"occasion":{"match_occasion_id":null,"name":null},"profile_summary":null,"role_title":null,"tags":[],"they_help_me_with":null}],"user_facts":[]}

EXISTING PEOPLE (id :: name):
${peopleList}

EXISTING OCCASIONS (id :: name):
${occasionList}

EXISTING TAGS: ${tagList}

GLOSSARY (already applied to the text): 
${glossaryList}

ABOUT THE USER (the person using this app — use this context to resolve references like "my PI" or "my cofounder" and to write better summaries; never reveal it verbatim):
${profileText}

RECENT CONVERSATION (this session, for pronoun resolution):
${convo}

Today is ${today}, ${nowTime} America/Los_Angeles.`;
}

/** Heuristic: is this "tag" actually a relationship descriptor? */
export function isRelationshipDescriptor(tag: string, personNames: string[]): boolean {
  const t = tag.toLowerCase();
  if (/(’s|s')\s+(friend|mom|dad|brother|sister|partner|colleague)/.test(t)) return true;
  if (/^(my|friend of|friends with)\b/.test(t)) return true;
  for (const n of personNames) {
    const nn = normalizeEntity(n);
    if (nn.length >= 3 && normalizeEntity(t).includes(nn) && /friend|met through|via/.test(t)) return true;
  }
  return false;
}

async function resolveTagIds(
  userId: string,
  tagNames: string[],
  existing: { id: string; name: string }[],
  personNames: string[],
  mutualExtra: string[],
): Promise<string[]> {
  const ids: string[] = [];
  const pool = [...existing];
  for (const rawName of tagNames) {
    const name = (rawName || '').trim();
    if (!name) continue;
    if (isRelationshipDescriptor(name, personNames)) {
      mutualExtra.push(name);
      continue;
    }
    const match = bestMatch(name, pool, 0.72);
    if (match) {
      ids.push(match.item.id);
      continue;
    }
    // create — only because this person will carry it
    const [row] = await db.insert(schema.tags).values({ userId, name }).returning();
    pool.push({ id: row.id, name: row.name });
    ids.push(row.id);
  }
  return [...new Set(ids)];
}

/** Delete tags that no person carries. */
export async function pruneEmptyTags(userId: string): Promise<number> {
  const used = await db
    .select({ tagId: schema.personTags.tagId })
    .from(schema.personTags)
    .innerJoin(schema.tags, eq(schema.personTags.tagId, schema.tags.id))
    .where(eq(schema.tags.userId, userId));
  const usedIds = new Set(used.map((r) => r.tagId));
  const all = await db.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.userId, userId));
  const empty = all.map((t) => t.id).filter((id) => !usedIds.has(id));
  if (empty.length) {
    await db.delete(schema.tags).where(inArray(schema.tags.id, empty));
  }
  return empty.length;
}

export type CaptureResult = {
  personId: string;
  personName: string;
  isNew: boolean;
  encounterId: string;
  /** true when the organizer was unsure about the name spelling — prompt the user to confirm */
  nameUncertain: boolean;
}[];

/** Passive user-profile memory: merge newly revealed facts into profile_facts.
 *  Dedups case-insensitively and skips near-duplicates (one containing the other).
 *  Never touches about_me. */
async function mergeUserFacts(userId: string, candidates: string[]): Promise<void> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
  const [row] = await db
    .select({ profileFacts: schema.users.profileFacts })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const existing = row?.profileFacts ?? [];
  const seen = new Set(existing.map((e) => norm(e.fact)));
  const fresh: { fact: string; learnedAt: string }[] = [];
  for (const c of candidates) {
    const fact = (c || '').trim();
    if (!fact || fact.length > 300) continue;
    const n = norm(fact);
    if (!n || seen.has(n)) continue;
    if ([...seen].some((s) => s.includes(n) || n.includes(s))) continue;
    seen.add(n);
    fresh.push({ fact, learnedAt: new Date().toISOString() });
  }
  if (fresh.length) {
    await db
      .update(schema.users)
      .set({ profileFacts: [...existing, ...fresh] })
      .where(eq(schema.users.id, userId));
  }
}

export async function organizeCapture(opts: {
  userId: string;
  text: string;
  aiCall?: AICall;
  recentTurns?: ConversationTurn[];
  signal?: AbortSignal;
}): Promise<CaptureResult> {
  const { userId } = opts;
  const rawText = (opts.text || '').trim();
  if (!rawText) throw new Error('empty');

  const [peopleRows, occasionRows, tagRows, glossaryRows, userRow] = await Promise.all([
    db.select({ id: schema.people.id, name: schema.people.name }).from(schema.people).where(eq(schema.people.userId, userId)),
    db.select({ id: schema.occasions.id, name: schema.occasions.name }).from(schema.occasions).where(eq(schema.occasions.userId, userId)),
    db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.userId, userId)),
    db.select().from(schema.glossary).where(eq(schema.glossary.userId, userId)),
    db.select({ aboutMe: schema.users.aboutMe, profileFacts: schema.users.profileFacts }).from(schema.users).where(eq(schema.users.id, userId)).limit(1),
  ]);
  const ctx: OrganizerContext = {
    people: peopleRows,
    occasions: occasionRows,
    tags: tagRows,
    glossary: glossaryRows,
    profile: {
      aboutMe: userRow[0]?.aboutMe ?? null,
      facts: (userRow[0]?.profileFacts ?? []).map((f) => f.fact),
    },
  };

  const corrected = applyGlossary(rawText, glossaryRows);
  const { date: today, time: nowTime } = laNow();
  const aiCall = opts.aiCall ?? trackedAICall(userId, 'capture');
  const raw = await aiCall(buildOrganizerPrompt(ctx, today, nowTime, opts.recentTurns ?? []), corrected, opts.signal);
  const parsed = parseJson<{ blocks: PersonBlock[]; user_facts?: string[] }>(raw);
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];

  // passive user-profile memory: merge newly revealed facts (no extra AI call)
  const revealed = Array.isArray(parsed.user_facts) ? parsed.user_facts : [];
  if (revealed.length) await mergeUserFacts(userId, revealed);

  if (!blocks.length) throw new Error('AI found no person in that note.');

  const personNames = peopleRows.map((p) => p.name);
  const results: CaptureResult = [];

  /** Normalize the AI's avatar block into an AvatarSpec (drops nulls). */
  const toAvatarSpec = (a: PersonBlock['avatar']) => {
    if (!a) return null;
    const spec: Record<string, string> = {};
    if (a.skin) spec.skin = a.skin;
    if (a.hair_style) spec.hairStyle = a.hair_style;
    if (a.hair_texture) spec.hairTexture = a.hair_texture;
    if (a.hair_color) spec.hairColor = a.hair_color;
    if (a.fringe) spec.fringe = a.fringe;
    if (a.glasses) spec.glasses = a.glasses;
    if (a.glasses_color) spec.glassesColor = a.glasses_color;
    if (a.beard) spec.beard = a.beard;
    return Object.keys(spec).length ? spec : null;
  };

  for (const b of blocks) {
    const name = (b.name || '').trim();
    let personId: string;
    let isNew: boolean;

    const matchedId = b.match_person_id && peopleRows.some((p) => p.id === b.match_person_id) ? b.match_person_id : null;

    if (matchedId) {
      personId = matchedId;
      isNew = false;
      // update with new info only (never rename via capture)
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const fields: (keyof PersonBlock)[] = [
        'headline', 'company', 'role_title', 'industry', 'intro_hook',
        'mutual_connections', 'likely_to_meet_again', 'they_help_me_with', 'i_offer_them', 'appearance',
      ];
      const colMap: Record<string, string> = {
        headline: 'headline', company: 'company', role_title: 'roleTitle', industry: 'industry',
        intro_hook: 'introHook', mutual_connections: 'mutualConnections', likely_to_meet_again: 'likelyToMeetAgain',
        they_help_me_with: 'theyHelpMeWith', i_offer_them: 'iOfferThem', appearance: 'appearance',
      };
      for (const f of fields) {
        const v = b[f];
        if (typeof v === 'string' && v.trim()) patch[colMap[f]] = v.trim();
      }
      // merge newly mentioned avatar attributes into the existing spec
      const avatarPatch = toAvatarSpec(b.avatar);
      if (avatarPatch) {
        const [cur] = await db.select({ avatarSpec: schema.people.avatarSpec }).from(schema.people).where(eq(schema.people.id, personId)).limit(1);
        patch.avatarSpec = { ...(cur?.avatarSpec ?? {}), ...avatarPatch };
      }
      if (typeof b.profile_summary === 'string' && b.profile_summary.trim()) {
        // only fill an empty summary, never overwrite the curated one silently
        const [cur] = await db.select({ summary: schema.people.summary }).from(schema.people).where(eq(schema.people.id, personId)).limit(1);
        if (cur && !cur.summary) patch.summary = b.profile_summary.trim();
      }
      await db.update(schema.people).set(patch).where(eq(schema.people.id, personId));
    } else {
      if (!name) continue;
      // deterministic guard: exact-ish name already exists → treat as update
      const dupe = bestMatch(name, peopleRows, 0.92);
      if (dupe) {
        personId = dupe.item.id;
        isNew = false;
      } else {
        const [row] = await db
          .insert(schema.people)
          .values({
            userId,
            name,
            headline: str(b.headline),
            summary: str(b.profile_summary),
            company: str(b.company),
            roleTitle: str(b.role_title),
            industry: str(b.industry),
            introHook: str(b.intro_hook),
            mutualConnections: str(b.mutual_connections),
            likelyToMeetAgain: str(b.likely_to_meet_again),
            theyHelpMeWith: str(b.they_help_me_with),
            iOfferThem: str(b.i_offer_them),
            appearance: str(b.appearance),
            avatarSpec: toAvatarSpec(b.avatar),
          })
          .returning({ id: schema.people.id, name: schema.people.name });
        personId = row.id;
        isNew = true;
        peopleRows.push({ id: row.id, name: row.name });
        personNames.push(row.name);
      }
    }

    // occasion
    let occasionId: string | null = null;
    const occRef = b.occasion;
    if (occRef) {
      if (occRef.match_occasion_id && occasionRows.some((o) => o.id === occRef.match_occasion_id)) {
        occasionId = occRef.match_occasion_id;
      } else if (occRef.name && occRef.name.trim()) {
        const m = bestMatch(occRef.name.trim(), occasionRows, 0.7);
        if (m) occasionId = m.item.id;
        else {
          const [o] = await db.insert(schema.occasions).values({ userId, name: occRef.name.trim() }).returning({ id: schema.occasions.id, name: schema.occasions.name });
          occasionId = o.id;
          occasionRows.push({ id: o.id, name: o.name });
        }
      }
    }

    // tags (minimal, hygienic)
    const mutualExtra: string[] = [];
    const tagIds = await resolveTagIds(userId, b.tags ?? [], tagRows.map((t) => ({ id: t.id, name: t.name })), personNames, mutualExtra);
    // refresh tag pool for subsequent blocks
    for (const id of tagIds) {
      const found = tagRows.find((t) => t.id === id);
      if (!found) {
        const [t] = await db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.id, id)).limit(1);
        if (t) tagRows.push(t);
      }
    }
    for (const tagId of tagIds) {
      await db.insert(schema.personTags).values({ personId, tagId }).onConflictDoNothing();
    }
    if (mutualExtra.length) {
      const extra = mutualExtra.join('; ');
      await db
        .update(schema.people)
        .set({
          mutualConnections: sql`CASE WHEN COALESCE(${schema.people.mutualConnections}, '') = '' THEN ${extra} ELSE ${schema.people.mutualConnections} || ${'; ' + extra} END`,
          updatedAt: new Date(),
        })
        .where(eq(schema.people.id, personId));
    }

    // encounter
    const encSummary = str(b.encounter_summary) || str(b.profile_summary) || corrected.slice(0, 160);
    const [enc] = await db
      .insert(schema.encounters)
      .values({ userId, personId, occasionId, summary: encSummary, originalNote: rawText })
      .returning({ id: schema.encounters.id });

    // follow-ups
    for (const f of b.follow_ups ?? []) {
      const text = (f.text || '').trim();
      if (!text) continue;
      let due: string | null = null;
      if (f.due_date && /^\d{4}-\d{2}-\d{2}$/.test(f.due_date)) due = f.due_date;
      await db.insert(schema.followUps).values({ userId, personId, text, dueDate: due });
    }

    const [pRow] = await db.select({ name: schema.people.name }).from(schema.people).where(eq(schema.people.id, personId)).limit(1);
    results.push({ personId, personName: pRow?.name ?? name, isNew, encounterId: enc.id, nameUncertain: !!b.name_uncertain });
  }

  await pruneEmptyTags(userId);
  return results;
}

// ---------------------------------------------------------------------------
// Rehearse: "I'm going to X — who will I run into?"
// ---------------------------------------------------------------------------

export async function suggestForRehearse(opts: {
  userId: string;
  text: string;
  aiCall?: AICall;
}): Promise<{ occasionIds: string[]; tagIds: string[] }> {
  const { userId } = opts;
  const text = (opts.text || '').trim();
  if (!text) return { occasionIds: [], tagIds: [] };

  const [occasionRows, tagRows, glossaryRows] = await Promise.all([
    db.select({ id: schema.occasions.id, name: schema.occasions.name }).from(schema.occasions).where(eq(schema.occasions.userId, userId)),
    db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.userId, userId)),
    db.select().from(schema.glossary).where(eq(schema.glossary.userId, userId)),
  ]);
  const corrected = applyGlossary(text, glossaryRows);
  const norm = normalizeEntity(corrected);

  const occasionIds = new Set<string>();
  const tagIds = new Set<string>();
  // query tokens worth matching on (skip tiny filler words)
  const qTokens = new Set(norm.split(' ').filter((w) => w.length >= 3));
  const tokenHit = (name: string) => {
    if (name.length < 3) return false;
    if (norm.includes(name)) return true; // query contains the full name
    // or any significant token of the name appears in the query ("Haas" ~ "Haas E-Hub")
    return name
      .split(' ')
      .some((w) => w.length >= 3 && qTokens.has(w));
  };
  for (const o of occasionRows) {
    if (tokenHit(normalizeEntity(o.name))) occasionIds.add(o.id);
  }
  for (const t of tagRows) {
    if (tokenHit(normalizeEntity(t.name))) tagIds.add(t.id);
  }
  if (occasionIds.size || tagIds.size) return { occasionIds: [...occasionIds], tagIds: [...tagIds] };

  // semantic fallback via AI
  const aiCall = opts.aiCall ?? trackedAICall(userId, 'rehearse');
  const system = `You match a where-I'm-going sentence to the user's occasions and tags. Output ONLY JSON like {"occasions":["id"],"tags":["id"]} using ids from the lists. Empty arrays when nothing matches.
OCCASIONS:
${occasionRows.map((o) => `- ${o.id} :: ${o.name}`).join('\n') || '(none)'}
TAGS:
${tagRows.map((t) => `- ${t.id} :: ${t.name}`).join('\n') || '(none)'}`;
  try {
    const raw = await aiCall(system, corrected);
    const parsed = parseJson<{ occasions?: string[]; tags?: string[] }>(raw);
    const validO = new Set(occasionRows.map((o) => o.id));
    const validT = new Set(tagRows.map((t) => t.id));
    return {
      occasionIds: (parsed.occasions ?? []).filter((id) => validO.has(id)),
      tagIds: (parsed.tags ?? []).filter((id) => validT.has(id)),
    };
  } catch {
    return { occasionIds: [], tagIds: [] };
  }
}

// ---------------------------------------------------------------------------
// Maintenance: deterministic cleanup (merge near-duplicates, drop empties)
// ---------------------------------------------------------------------------

/**
 * Merge duplicate person records (same human, e.g. after a guest-data merge).
 * Groups by normalized name, keeps the oldest record, moves all linked rows
 * (encounters, tags, follow-ups, briefs, photos, jobs, suggestions, prospects)
 * onto it, fills empty text fields from the dupe, then deletes the dupe.
 * Returns the number of person records merged away.
 */
export async function mergeDuplicatePeople(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.people)
    .where(eq(schema.people.userId, userId))
    .orderBy(schema.people.createdAt);
  let merged = 0;
  const seen = new Map<string, (typeof rows)[number]>();
  for (const p of rows) {
    const key = normalizeEntity(p.name);
    const keep = seen.get(key);
    if (!keep) {
      seen.set(key, p);
      continue;
    }
    if (entitySimilarity(keep.name, p.name) < 0.8) {
      seen.set(key + '#' + p.id, p);
      continue;
    }
    // Move linked rows onto the kept person.
    await db.update(schema.encounters).set({ personId: keep.id }).where(eq(schema.encounters.personId, p.id));
    await db.update(schema.followUps).set({ personId: keep.id }).where(eq(schema.followUps.personId, p.id));
    await db.update(schema.photoCandidates).set({ personId: keep.id }).where(eq(schema.photoCandidates.personId, p.id));
    await db.update(schema.researchJobs).set({ personId: keep.id }).where(eq(schema.researchJobs.personId, p.id));
    await db.update(schema.prospects).set({ personId: keep.id }).where(eq(schema.prospects.personId, p.id));
    await db
      .update(schema.relationshipSuggestions)
      .set({ personId: keep.id })
      .where(eq(schema.relationshipSuggestions.personId, p.id));
    await db
      .update(schema.relationshipSuggestions)
      .set({ relatedPersonId: keep.id })
      .where(eq(schema.relationshipSuggestions.relatedPersonId, p.id));
    // person_tags: move links, ignoring conflicts when keep already has the tag.
    const links = await db.select().from(schema.personTags).where(eq(schema.personTags.personId, p.id));
    for (const l of links) {
      await db
        .insert(schema.personTags)
        .values({ personId: keep.id, tagId: l.tagId })
        .onConflictDoNothing();
    }
    await db.delete(schema.personTags).where(eq(schema.personTags.personId, p.id));
    // background_briefs has a unique (userId, personId): keep the existing brief.
    const keepBrief = await db
      .select({ id: schema.backgroundBriefs.id })
      .from(schema.backgroundBriefs)
      .where(and(eq(schema.backgroundBriefs.userId, userId), eq(schema.backgroundBriefs.personId, keep.id)))
      .limit(1);
    if (keepBrief.length) {
      await db.delete(schema.backgroundBriefs).where(eq(schema.backgroundBriefs.personId, p.id));
    } else {
      await db.update(schema.backgroundBriefs).set({ personId: keep.id }).where(eq(schema.backgroundBriefs.personId, p.id));
    }
    // Fill empty text fields on the kept record from the dupe.
    const patch: Record<string, unknown> = {};
    for (const f of [
      'headline', 'summary', 'company', 'roleTitle', 'industry', 'introHook',
      'mutualConnections', 'likelyToMeetAgain', 'theyHelpMeWith', 'iOfferThem',
      'appearance', 'contactNotes', 'conversation', 'avatarPhoto', 'avatarColor',
    ] as const) {
      if (!keep[f] && p[f]) patch[f] = p[f];
    }
    // Merge avatar specs field-wise: keep's described attributes win, gaps filled from dupe.
    if (p.avatarSpec && typeof p.avatarSpec === 'object') {
      const keepSpec = (keep.avatarSpec as Record<string, string> | null) ?? {};
      const mergedSpec: Record<string, string> = { ...keepSpec };
      for (const [k, v] of Object.entries(p.avatarSpec as Record<string, string>)) {
        if (!mergedSpec[k] && v) mergedSpec[k] = v;
      }
      if (Object.keys(mergedSpec).length && JSON.stringify(mergedSpec) !== JSON.stringify(keepSpec)) {
        patch.avatarSpec = mergedSpec;
      }
    }
    if (Object.keys(patch).length) {
      await db.update(schema.people).set({ ...patch, updatedAt: new Date() }).where(eq(schema.people.id, keep.id));
      Object.assign(keep, patch);
    }
    await db.delete(schema.people).where(eq(schema.people.id, p.id));
    await learnCorrection(userId, p.name, keep.name, 'person');
    merged++;
  }
  return merged;
}

export async function cleanupContacts(userId: string): Promise<{ mergedTags: number; mergedOccasions: number; prunedTags: number; mergedPeople: number }> {
  let mergedTags = 0;
  let mergedOccasions = 0;

  // merge duplicate tags: group by normalized name, keep the oldest
  const tagRows = await db.select().from(schema.tags).where(eq(schema.tags.userId, userId)).orderBy(schema.tags.createdAt);
  const seen = new Map<string, (typeof tagRows)[number]>();
  for (const t of tagRows) {
    const key = normalizeEntity(t.name);
    const keep = seen.get(key);
    if (!keep) {
      seen.set(key, t);
      continue;
    }
    // also require decent similarity for safety on short names
    if (entitySimilarity(keep.name, t.name) < 0.8) {
      seen.set(key + '#' + t.id, t);
      continue;
    }
    // move person links to the kept tag, then delete dupe
    const links = await db.select().from(schema.personTags).where(eq(schema.personTags.tagId, t.id));
    for (const l of links) {
      await db.insert(schema.personTags).values({ personId: l.personId, tagId: keep.id }).onConflictDoNothing();
    }
    await db.delete(schema.tags).where(eq(schema.tags.id, t.id));
    await learnCorrection(userId, t.name, keep.name, 'tag');
    mergedTags++;
  }

  // merge duplicate occasions the same way
  const occRows = await db.select().from(schema.occasions).where(eq(schema.occasions.userId, userId)).orderBy(schema.occasions.createdAt);
  const seenO = new Map<string, (typeof occRows)[number]>();
  for (const o of occRows) {
    const key = normalizeEntity(o.name);
    const keep = seenO.get(key);
    if (!keep) {
      seenO.set(key, o);
      continue;
    }
    if (entitySimilarity(keep.name, o.name) < 0.8) {
      seenO.set(key + '#' + o.id, o);
      continue;
    }
    await db.update(schema.encounters).set({ occasionId: keep.id }).where(eq(schema.encounters.occasionId, o.id));
    await db.delete(schema.occasions).where(eq(schema.occasions.id, o.id));
    await learnCorrection(userId, o.name, keep.name, 'occasion');
    mergedOccasions++;
  }

  const prunedTags = await pruneEmptyTags(userId);
  const mergedPeople = await mergeDuplicatePeople(userId);
  return { mergedTags, mergedOccasions, prunedTags, mergedPeople };
}

// ---------------------------------------------------------------------------
// Command routing: the capture box also takes imperative commands, photo
// requests, name-guess clues, and event-research requests.
// ---------------------------------------------------------------------------

export type CommandIntent =
  | { intent: 'capture' }
  | {
      intent: 'update';
      personId: string;
      personName: string;
      /** camelCase person columns → new values (null clears) */
      updates: Record<string, string | null>;
      /** abstract avatar building blocks, when physical appearance is described */
      avatar?: {
        skin?: string | null;
        hairStyle?: string | null;
        hairTexture?: string | null;
        hairColor?: string | null;
        fringe?: string | null;
        glasses?: string | null;
        glassesColor?: string | null;
        beard?: string | null;
      } | null;
      /** one-line summary of what changed, in the user's language */
      summary: string;
      ambiguousWith?: { id: string; name: string }[];
    }
  | { intent: 'photo'; personId: string; personName: string; another: boolean }
  | { intent: 'photo_revert'; personId: string; personName: string }
  | { intent: 'name_guess'; clues: string }
  | { intent: 'event_research'; eventHint: string; filters: string | null }
  | { intent: 'assistant' };

const PHOTO_WORDS = /\b(pic|pics|picture|pictures|photo|photos|image|avatar|headshot|照片|头像|相片)\b/i;
const NAME_CLUE_WORDS = /(starts with|ends with|first letter|last letter|what's (his|her|their) name|what is (his|her|their) name|开头|结尾|叫什么)/i;

type PersonRef = { id: string; name: string };

async function loadPeopleRefs(userId: string): Promise<PersonRef[]> {
  const rows = await db
    .select({ id: schema.people.id, name: schema.people.name })
    .from(schema.people)
    .where(eq(schema.people.userId, userId));
  return rows;
}

/** Find a person mentioned by name in free text (or via recent-turn pronouns). */
function findMentionedPerson(
  text: string,
  people: PersonRef[],
  recentTurns: ConversationTurn[],
): PersonRef | null {
  const norm = ` ${normalizeEntity(text)} `;
  let best: PersonRef | null = null;
  let bestScore = 0;
  let tied = false;
  for (const p of people) {
    const pname = normalizeEntity(p.name);
    if (!pname || pname.length < 3) continue;
    let score = 0;
    if (norm.includes(` ${pname} `)) {
      score = 1;
    } else {
      // any significant name token mentioned ("Jorge" in "get a pic for Jorge")
      const tokens = pname.split(' ').filter((w) => w.length >= 3);
      for (const tok of tokens) {
        if (norm.includes(` ${tok} `)) score = Math.max(score, 0.4 + 0.4 * (tok.length / pname.length));
      }
    }
    if (score > 0) {
      if (score > bestScore) {
        bestScore = score;
        best = p;
        tied = false;
      } else if (score === bestScore) {
        tied = true;
      }
    }
  }
  // ambiguous between two people → let the AI router disambiguate
  if (best && !tied) return best;
  // pronoun → most recent turn's person
  if (/\b(she|he|they|him|her|them|his|hers|theirs|她|他|他们|她们)\b/i.test(text)) {
    for (let i = recentTurns.length - 1; i >= 0; i--) {
      const names = recentTurns[i].personNames;
      if (names.length) {
        const pm = bestMatch(names[0], people, 0.8);
        if (pm) return pm.item;
      }
    }
  }
  return null;
}

function buildRouterPrompt(people: PersonRef[], recentTurns: ConversationTurn[], today: string): string {
  const peopleList = people.map((p) => `- ${p.id} :: ${p.name}`).join('\n') || '(none yet)';
  const convo =
    recentTurns.length
      ? recentTurns
          .slice(-6)
          .map((t, i) => `${i + 1}. "${t.text}"${t.personNames.length ? ` (about: ${t.personNames.join(', ')})` : ''}`)
          .join('\n')
      : '(none)';
  return `You route ONE user message for a relationship-memory app. Reply with ONLY JSON.

Intents:
- "capture": describing someone they met / a meeting (default).
- "update": imperative correction about an EXISTING person ("his last name is Otero-Millan", "I'm his RA, not the other way around", "she works at Google now"). Output the person id and ONLY the fields that change, as camelCase person columns: name, headline, company, roleTitle, industry, introHook, mutualConnections, likelyToMeetAgain, theyHelpMeWith, iOfferThem, appearance, summary. Use null to clear a wrong value. When physical appearance is described ("long blonde hair", "wears glasses", "has a beard"), ALSO output an "avatar" object with ONLY the mentioned building blocks: skin one of light/medium-light/medium/medium-dark/dark; hair_style one of bald/short/medium/long/bun; hair_texture straight/curly; hair_color one of black/brown/blonde/red/gray/white; fringe one of none/fringe (only when bangs or fringe are explicitly mentioned, default none); glasses one of none/rect/round; glasses_color one of black/brown/gold/silver; beard one of none/short/full. Never guess unmentioned fields.
- "photo": wants a photo found for someone ("get a pic for Jorge"). Output person id + whether they want a DIFFERENT photo ("another": true when they say another/new/different).
- "photo_revert": wants to go back to the previous photo ("change it back", "revert to the old photo", "use the previous picture"). Output person id.
- "name_guess": trying to recall a name from partial clues ("starts with D", "ends with a").
- "event_research": wants people researched for an upcoming event ("I'm going to X tomorrow, only find engineers"). Output eventHint (event name) and filters (e.g. "engineers") or null.
- "assistant": a question about their contacts/data, or a general request the other intents don't cover ("why don't my first two contacts have tags", "how many people did I meet last month", "fix it", "help", "which of my contacts work in AI", "delete Meng Lin"). Anything conversational that isn't a memory to save. Prefer this over "capture" whenever the message is a question or asks the app to do something.

ENTITY ATTRIBUTION: "I/me" is the USER. "I'm his RA" means the USER is the research assistant — set the contact's mutualConnections to note the user is their RA; NEVER set the contact's role to RA. "She's my PI" makes HER the PI (headline "PI at ...").

PRONOUNS ("she/he/they/him/her"): resolve against RECENT CONVERSATION and people list.

If the target person is ambiguous between two listed people, pick the best and set ambiguousWith to the other candidate(s).

Shapes:
{"intent":"capture"}
{"intent":"update","person_id":"...","updates":{"lastName?": "no — use valid columns only"},"summary":"..."}
{"intent":"photo","person_id":"...","another":false}
{"intent":"photo_revert","person_id":"..."}
{"intent":"name_guess"}
{"intent":"event_research","eventHint":"...","filters":"... or null"}
{"intent":"assistant"}

EXISTING PEOPLE:
${peopleList}

RECENT CONVERSATION:
${convo}

Today is ${today}.`;
}

/**
 * Route raw capture-box text: capture vs update command vs photo request vs
 * name-guess vs event research. Deterministic fast paths first, AI fallback.
 */
export async function routeCaptureText(opts: {
  userId: string;
  text: string;
  recentTurns?: ConversationTurn[];
  aiCall?: AICall;
  signal?: AbortSignal;
}): Promise<CommandIntent> {
  const { userId, text } = opts;
  const recentTurns = opts.recentTurns ?? [];
  const people = await loadPeopleRefs(userId);
  const aiCall = opts.aiCall ?? trackedAICall(userId, 'router');

  // Fast path 1: photo request — photo word + identifiable person
  if (PHOTO_WORDS.test(text)) {
    const person = findMentionedPerson(text, people, recentTurns);
    if (person) {
      return {
        intent: 'photo',
        personId: person.id,
        personName: person.name,
        another: /another|different|new one|换|另一|新的/i.test(text),
      };
    }
  }

  // Fast path 1b: revert to previous photo ("change it back", "revert")
  if (/change it back|revert|previous photo|old photo|use the (old|previous) (one|pic|photo)|改回|换回/i.test(text)) {
    let person = findMentionedPerson(text, people, recentTurns);
    if (!person && recentTurns.length) {
      // "change it back" with no name — the most recent person in this session
      for (let i = recentTurns.length - 1; i >= 0; i--) {
        const names = recentTurns[i].personNames;
        if (names.length) {
          const pm = bestMatch(names[0], people, 0.8);
          if (pm) {
            person = pm.item;
            break;
          }
        }
      }
    }
    if (person) return { intent: 'photo_revert', personId: person.id, personName: person.name };
  }

  // Fast path 2: name-guess clues
  if (NAME_CLUE_WORDS.test(text) && !PHOTO_WORDS.test(text)) {
    return { intent: 'name_guess', clues: text.trim() };
  }

  // AI fallback for update / event_research / capture
  try {
    const raw = await aiCall(buildRouterPrompt(people, recentTurns, laNow().date), text.trim(), opts.signal);
    const parsed = parseJson<{
      intent: string;
      person_id?: string;
      updates?: Record<string, string | null>;
      avatar?: Record<string, string | null> | null;
      summary?: string;
      another?: boolean;
      eventHint?: string;
      filters?: string | null;
      ambiguousWith?: { id: string; name: string }[];
    }>(raw);
    const validIds = new Set(people.map((p) => p.id));
    if (parsed.intent === 'update' && parsed.person_id && validIds.has(parsed.person_id)) {
      const person = people.find((p) => p.id === parsed.person_id)!;
      const allowed = new Set([
        'name', 'headline', 'company', 'roleTitle', 'industry', 'introHook',
        'mutualConnections', 'likelyToMeetAgain', 'theyHelpMeWith', 'iOfferThem', 'appearance', 'summary',
      ]);
      const updates: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(parsed.updates ?? {})) {
        if (allowed.has(k)) updates[k] = typeof v === 'string' ? v.trim() : null;
      }
      // avatar building blocks (only mentioned fields)
      let avatar: Record<string, string> | null = null;
      if (parsed.avatar && typeof parsed.avatar === 'object') {
        const clean: Record<string, string> = {};
        for (const k of ['skin', 'hairStyle', 'hairTexture', 'hairColor', 'fringe', 'glasses', 'glassesColor', 'beard']) {
          // accept both camelCase and snake_case from the model
          const v = parsed.avatar[k] ?? parsed.avatar[k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())];
          if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
        }
        // map snake_case keys the model may emit
        const snakeMap: Record<string, string> = {
          hair_style: 'hairStyle', hair_texture: 'hairTexture', hair_color: 'hairColor',
          glasses_color: 'glassesColor',
        };
        for (const [sk, ck] of Object.entries(snakeMap)) {
          const v = parsed.avatar[sk];
          if (typeof v === 'string' && v.trim() && !clean[ck]) clean[ck] = v.trim();
        }
        if (Object.keys(clean).length) avatar = clean;
      }
      if (Object.keys(updates).length || avatar) {
        return {
          intent: 'update',
          personId: person.id,
          personName: person.name,
          updates,
          avatar,
          summary: (parsed.summary || 'Updated.').trim(),
          ambiguousWith: parsed.ambiguousWith,
        };
      }
    }
    if (parsed.intent === 'photo' && parsed.person_id && validIds.has(parsed.person_id)) {
      const person = people.find((p) => p.id === parsed.person_id)!;
      return { intent: 'photo', personId: person.id, personName: person.name, another: !!parsed.another };
    }
    if (parsed.intent === 'photo_revert' && parsed.person_id && validIds.has(parsed.person_id)) {
      const person = people.find((p) => p.id === parsed.person_id)!;
      return { intent: 'photo_revert', personId: person.id, personName: person.name };
    }
    if (parsed.intent === 'name_guess') return { intent: 'name_guess', clues: text.trim() };
    if (parsed.intent === 'event_research' && parsed.eventHint) {
      return { intent: 'event_research', eventHint: parsed.eventHint, filters: parsed.filters ?? null };
    }
    if (parsed.intent === 'assistant') return { intent: 'assistant' };
  } catch {
    // fall through to capture
  }
  return { intent: 'capture' };
}

/** Apply an update command: change only the requested fields, learn renames. */
export async function applyCommandUpdate(
  userId: string,
  personId: string,
  updates: Record<string, string | null>,
  avatar?: Record<string, string | null> | null,
): Promise<{ changedFields: string[]; personName: string }> {
  const cur = await db
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), eq(schema.people.id, personId)))
    .limit(1);
  const person = cur[0];
  if (!person) throw new Error('person_not_found');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const changedFields: string[] = [];
  for (const [k, v] of Object.entries(updates)) {
    const curVal = (person as Record<string, unknown>)[k];
    const next = v && v.length ? v : null;
    if (next !== curVal) {
      patch[k] = next;
      changedFields.push(k);
    }
  }
  // merge newly described avatar building blocks into the existing spec
  if (avatar && Object.keys(avatar).length) {
    const curSpec = (person.avatarSpec as Record<string, string> | null) ?? {};
    const merged = { ...curSpec };
    for (const [k, v] of Object.entries(avatar)) {
      if (typeof v === 'string' && v && merged[k] !== v) merged[k] = v;
    }
    if (JSON.stringify(merged) !== JSON.stringify(curSpec)) {
      patch.avatarSpec = merged;
      changedFields.push('avatarSpec');
    }
  }
  if (changedFields.length) {
    await db.update(schema.people).set(patch).where(eq(schema.people.id, personId));
  }
  // learn renames so future dictation gets them right
  if ('name' in patch && typeof patch.name === 'string' && patch.name !== person.name) {
    await learnCorrection(userId, person.name, patch.name, 'person');
  }
  return { changedFields, personName: (patch.name as string) || person.name };
}

// ---------------------------------------------------------------------------
// Name guessing from partial clues ("starts with D, ends with a")
// ---------------------------------------------------------------------------

export type NameGuessResult = {
  contacts: { id: string; name: string; headline: string | null }[];
  guesses: string[];
};

/** Parse "starts with X" / "ends with Y" clues out of free text. */
function parseNameClues(text: string): { first?: string; last?: string } {
  const t = text.toLowerCase();
  const out: { first?: string; last?: string } = {};
  let m = t.match(/starts with\s+([a-z\u4e00-\u9fff])/i) || t.match(/开头\s*([a-z\u4e00-\u9fff])/i);
  if (m) out.first = m[1].toLowerCase();
  m = t.match(/ends with\s+([a-z\u4e00-\u9fff])/i) || t.match(/结尾\s*([a-z\u4e00-\u9fff])/i);
  if (m) out.last = m[1].toLowerCase();
  return out;
}

export async function guessNames(opts: {
  userId: string;
  clues: string;
  aiCall?: AICall;
  signal?: AbortSignal;
}): Promise<NameGuessResult> {
  const { userId, clues } = opts;
  const { first, last } = parseNameClues(clues);
  const rows = await db
    .select({ id: schema.people.id, name: schema.people.name, headline: schema.people.headline })
    .from(schema.people)
    .where(eq(schema.people.userId, userId))
    .limit(500);

  // 1) saved contacts first — highest value
  const contacts = rows
    .filter((p) => {
      const n = p.name.trim().toLowerCase();
      if (!n) return false;
      if (first && !n.startsWith(first)) return false;
      if (last && !n.replace(/[^a-z\u4e00-\u9fff]/gi, '').endsWith(last)) return false;
      return true;
    })
    .slice(0, 6)
    .map((p) => ({ id: p.id, name: p.name, headline: p.headline }));

  // 2) common-name guesses as memory joggers, clearly labeled
  let guesses: string[] = [];
  try {
    const aiCall = opts.aiCall ?? trackedAICall(userId, 'name_guess');
    const system = `You help someone recall a person's name from partial clues. Suggest up to 6 common real first names (or full names when the clue implies it) matching the clues. These are MEMORY JOGGERS, not facts. Output ONLY JSON: {"guesses":["..."]}. No commentary.`;
    const raw = await aiCall(system, `Clues: ${clues}\nKnown contacts (do not repeat these): ${rows.map((r) => r.name).join(', ') || '(none)'}`, opts.signal);
    const parsed = parseJson<{ guesses?: string[] }>(raw);
    guesses = (parsed.guesses ?? []).filter((g) => typeof g === 'string' && g.trim()).slice(0, 6);
  } catch {
    guesses = [];
  }
  return { contacts, guesses };
}
