# ReMeet

**Turn connections into opportunities.**

ReMeet is an AI networking companion for before, during, and after every event. Built at c0mpiled-14 (YC RFS: AI consumer apps).

**Try the live app:** https://web-production-30e9f.up.railway.app
Demo login: demo@remeet.team / ReMeetDemo2026

## What it does

**Before the event**
- Events picked for you from your interests, plus any event you paste in
- A full brief for each event: what it is, what it looks like, whether it is worth your time, and your goal
- People to Meet: hosts, judges, and speakers pulled from the event page, each with a reason why they are worth meeting, written for you

**During the event**
- Start a live session at the event you are attending
- Add who you meet in one line ("I met Kareena, Berkeley E-Hub advisor")
- ReMeet files them under the event and looks them up on the spot, so you know what to talk about

**After the event**
- An automatic wrap-up of every event session
- Every open follow-up in one list, with one-tap AI message drafts you can copy and send yourself

**People**
- Everyone you have ever met, each with a researched profile: role, background, conversation topics, and sources

## How it is built

- Next.js (App Router) + TypeScript, Tailwind CSS
- Postgres with Drizzle ORM, deployed on Railway
- Anthropic Claude with live web search for event research, people briefs, and message drafts
- Follow-ups are drafted, never auto-sent

## Run it locally

npm install, set DATABASE_URL and ANTHROPIC_API_KEY in .env, then npm run dev.
