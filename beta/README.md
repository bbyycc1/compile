# Friends Beta — name-remembering event app (standalone web app)

A private web app for remembering people you meet at events — now in four
languages (English / 简中 / 繁中 / Español). Voice or type a messy brain-dump;
the AI organizer files it into contacts, occasions, tags, and follow-ups.
The capture box also takes commands ("get a pic for Jorge"), remembers the
conversation ("get her picture"), guesses names from partial clues, and
researches people online automatically. Rehearse before the next event.

**Stack:** Next.js 16 · React 19 · Tailwind v4 · Drizzle ORM · PostgreSQL ·
Anthropic API. Hand-rolled sessions (bcrypt + httpOnly cookies). Photos are
resized client-side (~256px) and stored as data URLs — no object storage needed
for a small beta.

## Run locally

Prerequisites: Node 20+, PostgreSQL 14+.

```bash
cd beta
npm install
cp .env.example .env        # fill in DATABASE_URL + ANTHROPIC_API_KEY
createdb nameapp             # or: sudo -u postgres createdb nameapp
node scripts/migrate.mjs     # creates tables (also runs automatically in Docker)
npm run dev                  # http://localhost:3000
```

Without `ANTHROPIC_API_KEY` the app runs, but capture returns
`503 ai_unavailable` with a clear message — everything else works.

Useful scripts:

| script | what it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production build / serve |
| `node scripts/migrate.mjs` | apply pending SQL migrations in `drizzle/` |
| `npx drizzle-kit generate` | regenerate migrations after `src/lib/db/schema.ts` changes |

## How it works

- **Capture** (`POST /api/capture`): glossary pre-pass (your personal proper-noun
  corrections, e.g. Berkeley House → Haas) → Anthropic extracts people,
  occasions, tags, follow-ups as JSON → deterministic fuzzy-match guard merges
  near-duplicate people/tags/occasions (case, punctuation, word order, typos,
  abbreviations like "E-Hub" ~ "Entrepreneurship Hub") → inserts encounter with
  the raw note preserved as `originalNote`, prunes empty tags.
- **Corrections are learned, not asked about**: editing a name/company/tag/
  occasion writes to the glossary and renames propagate to existing records
  automatically. The cleanup pass (`POST /api/maintenance/cleanup`) merges
  duplicates globally and remembers what it did.
- **Rehearse** (`POST /api/rehearse/suggest`): deterministic occasion/tag match
  for "I'm going to X", AI fallback when nothing matches literally.
- All data is scoped per user (`user_id` on every table). New users start empty.
- **Command routing** (`POST /api/capture` first runs the router): imperative
  updates ("his last name is Otero-Millan", "I'm his RA, not the other way
  around") fuzzy-match the person, change only the requested fields, and confirm
  briefly — asking when ambiguous. Photo requests ("get a pic for Jorge") swap
  instantly from a pre-warmed cache or run a bounded lookup. Name-guess clues
  ("starts with D, ends with a") check saved contacts first, then offer labeled
  common-name guesses. Event-research requests ("I'm going to X tomorrow, only
  find engineers") create a prospect-event card; prospects stay separate from
  contacts until "We've met" converts one.
- **Conversational memory**: the capture box sends the last few turns of the
  session; pronouns ("she", "get her picture") resolve against recent context.
- **Background research** (`src/lib/research.ts`, Anthropic web-search tool):
  new contacts with enough identity get a concise "Background (found online)"
  brief (role+org, last 1–2 roles, school+degree, one notable fact, sources) and
  a verified photo — only on confident identity match, never overwriting user
  notes. Research jobs drive the subtle "looking up…" avatar state. Opening a
  profile pre-warms alternate photos so "find another photo" swaps in under
  5 seconds. Coworker links found in research become one-tap Yes/No relationship
  suggestions — never auto-asserted.
- **Desktop layout**: persistent sidebar nav, narrow bottom-centered composer,
  people list + profile side by side, right-click delete on person rows; mobile
  keeps bottom tabs and swipe-to-delete.
- Relative dates resolve in America/Los_Angeles for follow-up due dates only.

## Deploy to Railway

1. Create a Railway account (needs Lilly's account) and a new project from this
   repo (Railway detects the `Dockerfile`).
2. Add a PostgreSQL plugin — Railway injects `DATABASE_URL` automatically.
3. Set variables: `ANTHROPIC_API_KEY` (required for the organizer),
   `ANTHROPIC_MODEL` (optional; otherwise the newest Sonnet is picked at runtime),
   `PGSSL=true` if the DB needs SSL.
4. Deploy. The container runs migrations on boot, then starts the app.

## Project layout

```
src/
  app/
    (app)/            # authed tabs: capture, people, rehearse, follow-ups, settings
    api/              # auth, capture, people, occasions, tags, followups,
                      # rehearse/suggest, glossary, maintenance/cleanup, export
  components/         # Composer (voice), Avatar, InlineField, PersonRow, TagBar,
                      # FollowUpItem, VoiceInput, ConfirmDialog, TabBar
  lib/
    organizer.ts      # fuzzy matching, glossary, Anthropic extraction, cleanup
    auth.ts           # sessions
    db/               # drizzle schema + lazy pg pool
    i18n/             # en / zh-Hans / zh-Hant dictionaries
drizzle/              # SQL migrations (generated)
scripts/migrate.mjs   # boot-time migration runner
```
