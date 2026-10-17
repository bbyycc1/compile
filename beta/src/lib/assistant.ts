import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from './db';
import {
  getAnthropic,
  resolveModel,
  applyCommandUpdate,
  type ConversationTurn,
} from './organizer';
import { listPeople, getProfile } from './people-queries';
import { deletePersonWithSnapshot, type PersonSnapshot } from './person-snapshot';
import { recordUsage } from './usage';

// ---------------------------------------------------------------------------
// Conversational assistant fallback for the capture box.
// When input doesn't match the fast paths (memory, update, photo, name guess,
// event research), the router classifies it as `assistant` and this tool-using
// agent handles it: answers questions about contacts, resolves positional
// references ("first two", "last one"), and takes actions (tags, fields,
// follow-ups). Deletes always require explicit confirmation.
// ---------------------------------------------------------------------------

const MAX_STEPS = 5;

const UPDATE_FIELDS = new Set([
  'name', 'headline', 'company', 'roleTitle', 'industry', 'introHook',
  'mutualConnections', 'likelyToMeetAgain', 'theyHelpMeWith', 'iOfferThem',
  'appearance', 'summary',
]);

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_people',
    description:
      'List all contacts in current display order (the same order the user sees). Returns numbered entries with id, name, headline, and tag names.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_person',
    description: 'Get the full profile of one contact: summary, company, role, tags, encounters, follow-ups.',
    input_schema: {
      type: 'object',
      properties: { person_id: { type: 'string', description: 'The contact UUID' } },
      required: ['person_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_person',
    description:
      'Change fields on a contact. Allowed fields: name, headline, company, roleTitle, industry, introHook, mutualConnections, likelyToMeetAgain, theyHelpMeWith, iOfferThem, appearance, summary. Only set fields the user asked to change.',
    input_schema: {
      type: 'object',
      properties: {
        person_id: { type: 'string' },
        updates: { type: 'object', description: 'camelCase field -> new value (string)' },
      },
      required: ['person_id', 'updates'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_tag',
    description:
      'Add a tag to one or more contacts. Reuses an existing tag when the name matches (case-insensitive), otherwise creates it.',
    input_schema: {
      type: 'object',
      properties: {
        person_ids: { type: 'array', items: { type: 'string' }, description: 'Contact UUIDs' },
        tag: { type: 'string', description: 'Tag name, e.g. "UC Berkeley Optometry"' },
      },
      required: ['person_ids', 'tag'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_tag',
    description: 'Remove a tag from one or more contacts.',
    input_schema: {
      type: 'object',
      properties: {
        person_ids: { type: 'array', items: { type: 'string' } },
        tag: { type: 'string', description: 'Tag name' },
      },
      required: ['person_ids', 'tag'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_tags',
    description: 'List all tags with how many contacts carry each.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'add_followup',
    description: 'Add a follow-up reminder, optionally linked to a contact and/or a due date (yyyy-mm-dd).',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to follow up on' },
        person_id: { type: 'string', description: 'Contact UUID (optional)' },
        due_date: { type: 'string', description: 'yyyy-mm-dd (optional)' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_person',
    description:
      'PERMANENTLY delete a contact and all their data. ONLY call this when the user explicitly confirmed the delete in a previous message of this conversation (you asked "Delete X?" and they said yes). If they have not confirmed, do NOT call — ask first.',
    input_schema: {
      type: 'object',
      properties: { person_id: { type: 'string', description: 'Contact UUID' } },
      required: ['person_id'],
      additionalProperties: false,
    },
  },
];

type ToolContext = {
  userId: string;
  trackChange: () => void;
  trackPerson: (name: string) => void;
  trackDelete: (snap: PersonSnapshot) => void;
};

async function toolListPeople(userId: string) {
  const cards = await listPeople(userId);
  return cards.map((c, i) => ({
    position: i + 1,
    id: c.id,
    name: c.name,
    headline: c.headline,
    tags: c.tags.map((t) => t.name),
    updatedAt: c.updatedAt,
  }));
}

async function toolAddTag(userId: string, personIds: string[], tagName: string, ctx: ToolContext) {
  const clean = (tagName || '').trim();
  if (!clean) return { error: 'empty tag name' };
  const ids = [...new Set(personIds)].filter(Boolean);
  if (!ids.length) return { error: 'no people specified' };

  const existing = await db.select().from(schema.tags).where(eq(schema.tags.userId, userId));
  let tag = existing.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (!tag) {
    const [row] = await db.insert(schema.tags).values({ userId, name: clean }).returning();
    tag = row;
  }
  const people = await db
    .select({ id: schema.people.id, name: schema.people.name })
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), inArray(schema.people.id, ids)));
  const valid = new Set(people.map((p) => p.id));
  const linked: string[] = [];
  for (const pid of ids) {
    if (!valid.has(pid)) continue;
    await db
      .insert(schema.personTags)
      .values({ personId: pid, tagId: tag.id })
      .onConflictDoNothing();
    const p = people.find((x) => x.id === pid)!;
    linked.push(p.name);
    ctx.trackPerson(p.name);
  }
  ctx.trackChange();
  return { tag: tag.name, addedTo: linked };
}

async function toolRemoveTag(userId: string, personIds: string[], tagName: string, ctx: ToolContext) {
  const clean = (tagName || '').trim().toLowerCase();
  const existing = await db.select().from(schema.tags).where(eq(schema.tags.userId, userId));
  const tag = existing.find((t) => t.name.toLowerCase() === clean);
  if (!tag) return { removed: [], note: `no tag named "${tagName}"` };
  const people = await db
    .select({ id: schema.people.id, name: schema.people.name })
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), inArray(schema.people.id, personIds)));
  const removed: string[] = [];
  for (const p of people) {
    await db
      .delete(schema.personTags)
      .where(and(eq(schema.personTags.personId, p.id), eq(schema.personTags.tagId, tag.id)));
    removed.push(p.name);
    ctx.trackPerson(p.name);
  }
  ctx.trackChange();
  return { tag: tag.name, removedFrom: removed };
}

async function toolListTags(userId: string) {
  const tags = await db.select().from(schema.tags).where(eq(schema.tags.userId, userId));
  const links = await db
    .select({ tagId: schema.personTags.tagId })
    .from(schema.personTags)
    .innerJoin(schema.tags, eq(schema.personTags.tagId, schema.tags.id))
    .where(eq(schema.tags.userId, userId));
  const counts = new Map<string, number>();
  for (const l of links) counts.set(l.tagId, (counts.get(l.tagId) ?? 0) + 1);
  return tags.map((t) => ({ id: t.id, name: t.name, people: counts.get(t.id) ?? 0 }));
}

async function toolUpdatePerson(
  userId: string,
  personId: string,
  updates: Record<string, unknown>,
  ctx: ToolContext,
) {
  const clean: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(updates ?? {})) {
    if (UPDATE_FIELDS.has(k)) clean[k] = typeof v === 'string' ? v.trim() : null;
  }
  if (!Object.keys(clean).length) return { error: 'no valid fields to update' };
  const { changedFields, personName } = await applyCommandUpdate(userId, personId, clean);
  ctx.trackChange();
  ctx.trackPerson(personName);
  return { person: personName, changedFields };
}

async function toolAddFollowup(
  userId: string,
  text: string,
  personId: string | null,
  dueDate: string | null,
  ctx: ToolContext,
) {
  const v = (text || '').trim();
  if (!v) return { error: 'empty text' };
  let pid: string | null = null;
  if (personId) {
    const rows = await db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people)
      .where(and(eq(schema.people.userId, userId), eq(schema.people.id, personId)))
      .limit(1);
    if (!rows[0]) return { error: 'person not found' };
    pid = rows[0].id;
    ctx.trackPerson(rows[0].name);
  }
  const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null;
  await db.insert(schema.followUps).values({ userId, personId: pid, text: v, dueDate: due });
  ctx.trackChange();
  return { added: v, dueDate: due };
}

/** Deletes only run when the user explicitly confirmed in this conversation. */
function isDeleteConfirmed(
  personName: string,
  currentText: string,
  messages: Anthropic.MessageParam[],
): boolean {
  const t = currentText.trim();
  // Explicit delete commands.
  const affirmative =
    /^(yes|yeah|yep|yup|sure|confirm|do it|go ahead|ok|okay|delete)[.! ]*$/i.test(t) ||
    new RegExp(`delete\\s+(it|them|him|her|${personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i').test(t);
  // "X is not a person / that's a mistake / wrong entry" = they want it gone.
  const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mistake = new RegExp(
    `(${escaped}[^.]{0,40}(is not a person|is a mistake|was a mistake|shouldn.t (be|exist)|is wrong)|` +
      `(that|this|it) (is|was) (a mistake|not a person|wrong)[^.]{0,40}${escaped})`,
    'i',
  ).test(t);
  if (!affirmative && !mistake) return false;
  if (mistake) return true; // explicit "this entry shouldn't exist" needs no further confirmation
  const needle = personName.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const flat = JSON.stringify(m.content).toLowerCase();
    if (flat.includes('delete') && flat.includes(needle)) return true;
  }
  return false;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
  currentText: string,
  messages: Anthropic.MessageParam[],
): Promise<unknown> {
  const { userId } = ctx;
  switch (name) {
    case 'list_people':
      return toolListPeople(userId);
    case 'get_person': {
      const pid = String(input.person_id || '');
      const p = await getProfile(userId, pid);
      if (!p) return { error: 'person not found' };
      ctx.trackPerson(p.name);
      return {
        id: p.id,
        name: p.name,
        headline: p.headline,
        summary: p.summary,
        company: p.company,
        roleTitle: p.roleTitle,
        industry: p.industry,
        tags: p.tags.map((t) => t.name),
        encounters: p.encounters.slice(0, 5).map((e) => ({ summary: e.summary, occasion: e.occasionName })),
        followUps: p.followUps.slice(0, 5).map((f) => ({ text: f.text, dueDate: f.dueDate, done: f.done })),
      };
    }
    case 'update_person':
      return toolUpdatePerson(userId, String(input.person_id || ''), (input.updates ?? {}) as Record<string, unknown>, ctx);
    case 'add_tag':
      return toolAddTag(userId, (input.person_ids ?? []) as string[], String(input.tag || ''), ctx);
    case 'remove_tag':
      return toolRemoveTag(userId, (input.person_ids ?? []) as string[], String(input.tag || ''), ctx);
    case 'list_tags':
      return toolListTags(userId);
    case 'add_followup':
      return toolAddFollowup(
        userId,
        String(input.text || ''),
        input.person_id ? String(input.person_id) : null,
        input.due_date ? String(input.due_date) : null,
        ctx,
      );
    case 'delete_person': {
      const pid = String(input.person_id || '');
      const rows = await db
        .select({ id: schema.people.id, name: schema.people.name })
        .from(schema.people)
        .where(and(eq(schema.people.userId, userId), eq(schema.people.id, pid)))
        .limit(1);
      if (!rows[0]) return { error: 'person not found' };
      if (!isDeleteConfirmed(rows[0].name, currentText, messages)) {
        return {
          error: 'NOT_CONFIRMED',
          message: `You have not asked the user to confirm deleting ${rows[0].name} yet. Ask first: "Delete ${rows[0].name}? You can undo this."`,
        };
      }
      const snap = await deletePersonWithSnapshot(userId, pid);
      if (!snap) return { error: 'person not found' };
      ctx.trackChange();
      ctx.trackPerson(rows[0].name);
      ctx.trackDelete(snap);
      return { deleted: rows[0].name, snapshot: snap };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

function buildAssistantPrompt(
  peopleList: string,
  lang: string,
  today: string,
): string {
  return `You are the helpful assistant inside the user's personal contact manager. You answer questions about their contacts and take actions they ask for. Be concise and warm. Respond in the user's language (${lang}).

PEOPLE LIST — display order, newest first. "First" means #1, "last" the final entry:
${peopleList || '(no contacts yet)'}

RULES:
- Resolve positional references against the numbered list: "first two" = #1 and #2; "last one" = final entry; "2nd to last" = second from the end; "first" = #1.
- Answer the question first, then take the requested action. When you change something, confirm briefly in one line (e.g. "Done — added 'UC Berkeley Optometry' to Meng Lin and Jorge Otero-Millan.").
- Use the tools for facts and actions. NEVER invent people or IDs — only use IDs from the list.
- If a request is ambiguous (two people could match), ask which one.
- DELETES: if the user says a person entry is a mistake / not a real person / shouldn't exist (e.g. "Irvine is not a person", "that entry was a mistake"), treat that AS the confirmation and call delete_person right away — don't ask again. For vaguer delete requests, ask "Delete X? You can undo this." first and only call delete_person after they confirm. Deleted contacts can be undone, so say that instead of "can't be undone".
- If they just want to chat or ask something you can't do with the tools, answer helpfully in words.
- Do not narrate your tool calls. Just do them and report the outcome.

Today is ${today}.`;
}

export type AssistantResult = {
  response: string;
  changed: boolean;
  personNames: string[];
  deletedSnapshot?: PersonSnapshot | null;
};

export async function runAssistant(opts: {
  userId: string;
  text: string;
  recentTurns?: ConversationTurn[];
  lang?: string;
  signal?: AbortSignal;
}): Promise<AssistantResult> {
  const { userId, text } = opts;
  const recentTurns = opts.recentTurns ?? [];
  const lang = opts.lang ?? 'en';

  const client = await getAnthropic();
  const model = await resolveModel();

  const cards = await listPeople(userId);
  const peopleList = cards
    .map((c, i) => `${i + 1}. ${c.name}${c.headline ? ` — ${c.headline}` : ''} [tags: ${c.tags.map((t) => t.name).join(', ') || 'none'}] :: ${c.id}`)
    .join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const system = buildAssistantPrompt(peopleList, lang, today);

  const messages: Anthropic.MessageParam[] = [];
  for (const t of recentTurns.slice(-6)) {
    messages.push({ role: 'user', content: t.text });
    if (t.assistantResponse) messages.push({ role: 'assistant', content: t.assistantResponse });
  }
  messages.push({ role: 'user', content: text });

  let changed = false;
  const personNames = new Set<string>();
  let deletedSnapshot: PersonSnapshot | null = null;
  const ctx: ToolContext = {
    userId,
    trackChange: () => { changed = true; },
    trackPerson: (n: string) => { personNames.add(n); },
    trackDelete: (snap) => { deletedSnapshot = snap; },
  };

  let response = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const msg = await client.messages.create(
      {
        model,
        max_tokens: 1500,
        system,
        tools: TOOLS,
        messages,
      },
      { signal: opts.signal },
    );
    const mu = msg.usage;
    if (mu) void recordUsage(userId, 'assistant', model, mu.input_tokens ?? 0, mu.output_tokens ?? 0);
    messages.push({ role: 'assistant', content: msg.content });

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const texts = msg.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const textOut = texts.map((b) => b.text).join('').trim();
    if (textOut) response = textOut;

    if (!toolUses.length) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let result: unknown;
      try {
        result = await executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx, text, messages);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'tool failed' };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (!response) {
    response = lang.startsWith('zh') ? '我不太确定你的意思，能换个说法吗？' : "I'm not sure what you mean — could you rephrase that?";
  }
  return { response, changed, personNames: [...personNames], deletedSnapshot };
}
