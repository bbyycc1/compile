import { pgTable, uuid, text, varchar, timestamp, boolean, date, primaryKey, uniqueIndex, jsonb, integer, real } from 'drizzle-orm/pg-core';

// ---------- users & sessions ----------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // nullable for guest accounts (guests have no email/password until they convert)
  email: varchar('email', { length: 255 }).unique(),
  passwordHash: text('password_hash'),
  displayName: varchar('display_name', { length: 120 }),
  // 'en' | 'zh-Hans' | 'zh-Hant'
  language: varchar('language', { length: 16 }).notNull().default('en'),
  isGuest: boolean('is_guest').notNull().default(false),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // user-editable "About you" profile (like Claude/GPT memory)
  aboutMe: text('about_me'),
  // passively learned facts about the user: [{fact, learnedAt}]
  profileFacts: jsonb('profile_facts').$type<{ fact: string; learnedAt: string }[]>().notNull().default([]),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- people ----------
export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  // smart one-line descriptor, e.g. "Haas E-Hub coordinator"
  headline: varchar('headline', { length: 300 }),
  // concise 2-3 sentence AI profile summary
  summary: text('summary'),
  company: varchar('company', { length: 300 }),
  roleTitle: varchar('role_title', { length: 300 }),
  industry: varchar('industry', { length: 300 }),
  introHook: text('intro_hook'),
  mutualConnections: text('mutual_connections'),
  likelyToMeetAgain: text('likely_to_meet_again'),
  // two-sided relationship value
  theyHelpMeWith: text('they_help_me_with'),
  iOfferThem: text('i_offer_them'),
  appearance: text('appearance'),
  // free-form contact details (e.g. a LinkedIn URL) — preserved by prototype import
  contactNotes: text('contact_notes'),
  // remembered conversation topics — preserved by prototype import
  conversation: text('conversation'),
  // photo stored as resized data URL (client resizes to ~256px)
  avatarPhoto: text('avatar_photo'),
  avatarColor: varchar('avatar_color', { length: 32 }),
  // abstract avatar building blocks
  avatarSpec: jsonb('avatar_spec').$type<{
    skin?: string | null;
    hairStyle?: string | null;
    hairTexture?: string | null;
    hairColor?: string | null;
    fringe?: string | null;
    glasses?: string | null;
    glassesColor?: string | null;
    beard?: string | null;
  } | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- occasions (merged event/place entity; physical location is a detail) ----------
export const occasions = pgTable('occasions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 300 }).notNull(),
  locationDetail: text('location_detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- encounters (timeline entries) ----------
export const encounters = pgTable('encounters', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  occasionId: uuid('occasion_id').references(() => occasions.id, { onDelete: 'set null' }),
  // concise 2-3 sentence summary — this is what the timeline shows
  summary: text('summary').notNull(),
  // full raw capture, shown only under collapsed "Original note"
  originalNote: text('original_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- tags (minimal: only real groups, never empty) ----------
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  color: varchar('color', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const personTags = pgTable(
  'person_tags',
  {
    personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.personId, t.tagId] })],
);

// ---------- follow-ups ----------
export const followUps = pgTable('follow_ups', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  // future commitments keep due dates; past meeting dates are not stored
  dueDate: date('due_date'),
  done: boolean('done').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- personal proper-noun glossary (user corrections, remembered) ----------
export const glossary = pgTable('glossary', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // what was heard/typed, e.g. "Berkeley House"
  alias: varchar('alias', { length: 300 }).notNull(),
  // canonical form, e.g. "Haas"
  canonical: varchar('canonical', { length: 300 }).notNull(),
  kind: varchar('kind', { length: 64 }).notNull().default('entity'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('glossary_user_alias').on(t.userId, t.alias)]);

// ---------- background briefs ("Background (found online)" — never overwrites user notes) ----------
export const backgroundBriefs = pgTable('background_briefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  // concise: current role + org
  roleLine: text('role_line'),
  // last 1-2 relevant roles, one per line
  prevRoles: text('prev_roles'),
  // school + degree/field only, no years
  education: text('education'),
  // one notable networking-relevant fact
  notableFact: text('notable_fact'),
  // JSON array of {title, url}
  sources: text('sources'),
  // 'confident' | 'uncertain'
  confidence: varchar('confidence', { length: 16 }).notNull().default('uncertain'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('background_briefs_user_person').on(t.userId, t.personId)]);

// ---------- event prospect research (people not yet met — separate from contacts) ----------
export const prospectEvents = pgTable('prospect_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 300 }).notNull(),
  sourceUrl: text('source_url'),
  filters: text('filters'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prospects = pgTable('prospects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').notNull().references(() => prospectEvents.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  headline: varchar('headline', { length: 300 }),
  company: varchar('company', { length: 300 }),
  roleTitle: varchar('role_title', { length: 300 }),
  reason: text('reason'),
  photoUrl: text('photo_url'),
  // 'prospect' | 'met' (converted into a contact)
  status: varchar('status', { length: 16 }).notNull().default('prospect'),
  personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- relationship suggestions (one-tap confirm, never auto-asserted) ----------
export const relationshipSuggestions = pgTable('relationship_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  relatedPersonId: uuid('related_person_id').references(() => people.id, { onDelete: 'set null' }),
  relatedName: varchar('related_name', { length: 200 }),
  // e.g. 'works_with'
  relation: varchar('relation', { length: 64 }).notNull().default('works_with'),
  // user-facing question, e.g. "Meng Lin works with Jorge Otero-Millan (your PI). Mark her as your PI too?"
  message: text('message').notNull(),
  // 'pending' | 'accepted' | 'dismissed'
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- pre-warmed alternate photos (fast "another photo" swaps) ----------
export const photoCandidates = pgTable('photo_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  // remote URL or data URL
  photoUrl: text('photo_url').notNull(),
  sourceLabel: varchar('source_label', { length: 300 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- background research jobs (drives the "looking up..." avatar state) ----------
export const researchJobs = pgTable('research_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  // 'brief' | 'photo'
  kind: varchar('kind', { length: 16 }).notNull(),
  // 'running' | 'done' | 'failed'
  status: varchar('status', { length: 16 }).notNull().default('running'),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- optimistic capture ----------
// Raw note saved instantly; the organizer fills it in via a background job.
export const pendingCaptures = pgTable('pending_captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  recentTurns: jsonb('recent_turns').$type<{ text: string; personNames: string[]; assistantResponse?: string }[]>().notNull().default([]),
  // 'pending' | 'done' | 'failed'
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  // CaptureResult JSON on success
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- API usage tracking ----------
// One row per Anthropic API call, so the account owner can see spend.
export const apiUsage = pgTable('api_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // 'capture' | 'router' | 'rehearse' | 'name_guess' | 'research' | 'photo' | 'assistant' | ...
  feature: varchar('feature', { length: 32 }).notNull(),
  model: varchar('model', { length: 80 }).notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  // estimated USD cost, computed from pricing at insert time
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Occasion = typeof occasions.$inferSelect;
export type Encounter = typeof encounters.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
export type GlossaryEntry = typeof glossary.$inferSelect;
export type BackgroundBrief = typeof backgroundBriefs.$inferSelect;
export type ProspectEvent = typeof prospectEvents.$inferSelect;
export type Prospect = typeof prospects.$inferSelect;
export type RelationshipSuggestion = typeof relationshipSuggestions.$inferSelect;
export type PhotoCandidate = typeof photoCandidates.$inferSelect;
export type ResearchJob = typeof researchJobs.$inferSelect;
export type PendingCapture = typeof pendingCaptures.$inferSelect;
export type ApiUsage = typeof apiUsage.$inferSelect;
