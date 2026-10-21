# Nexus

An AI executive assistant for Gmail and Google/iCloud Calendar. It writes a
morning brief, answers questions about your mail and schedule, drafts
replies, tidies the inbox, sets up filters, manages events and keeps a
reminders list — by text or voice. Every change it makes is logged with an
undo, and it never sends email on its own.

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · Tailwind CSS 3
- **Clerk 7** for sign-in · **Supabase** (Postgres) for storage
- **Claude Sonnet 5.5** via the Anthropic SDK
- Google APIs (Gmail, Calendar, People) · CalDAV for iCloud
- Resend for the scheduled brief email · ElevenLabs or OpenAI for voice
- Hosted on **Vercel** (Node.js ≥ 20.9)

## Local setup

1. `cp .env.local.example .env.local` and fill it in — every variable is
   documented in that file.
2. Create the database tables: follow `SETUP.md` §1, then run the files in
   `migrations/` in order in the Supabase SQL editor.
3. `npm install`
4. `npm run dev` → http://localhost:3000

`SETUP.md` is the full guide: Google Cloud OAuth setup, every table, the
scheduler, and the reasoning behind each feature.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`) |
| `npm test` | Compiles `lib/` and runs `tests/*.test.cjs` on Node's built-in runner |

## Project structure

- `app/` — pages and API routes. `app/api/*` are server-only route
  handlers; each one checks the Clerk session first.
- `app/dashboard/` — the signed-in app (board, brief, email, calendar,
  reminders, activity, memory, settings).
- `lib/` — all business logic, kept out of routes so it can be tested.
- `proxy.ts` — Clerk session handling; protects `/dashboard` and
  `/onboarding`. (Next 16 renamed `middleware.ts` to `proxy.ts`.)
- `migrations/` — SQL to apply in order. Each file is idempotent.
- `tests/` — unit tests for `lib/`.

## Deploying

See `LAUNCH_CHECKLIST.md` before going public. In short: Vercel Pro (for the
hourly brief cron and commercial use), all env vars set in Vercel,
migrations applied, Google OAuth app verified for production.
