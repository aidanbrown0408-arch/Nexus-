# Launch checklist

What stands between this codebase and real users. The code side is done
(see "Done in code" at the bottom); everything above it is accounts,
settings and paperwork only you can do.

## 1. Blockers — the app can't go public without these

- [ ] **Google OAuth verification.** Nexus asks for Gmail scopes Google
      classes as *restricted* (`gmail.modify` and `gmail.settings.basic` —
      narrowed from four in October 2026), plus sensitive Calendar and
      Contacts scopes. Until the app is verified it is capped at 100 test
      users and shows an "unverified app" warning. Restricted scopes also
      require an annual third-party security assessment (CASA) through a
      Google-approved assessor. Start this first — it takes weeks.
      You will need: a verified domain, the privacy policy URL
      (`/privacy`), terms URL (`/terms`), a demo video of each scope in use,
      and a written justification per scope.
      Prepared answers, a demo-video script and a scope-reduction
      suggestion are in `GOOGLE_VERIFICATION.md`.
- [ ] **Vercel Pro.** Hobby is for non-commercial use only. Once on Pro,
      set `vercel.json`'s cron to `"0 * * * *"` and delete
      `.github/workflows/brief-cron.yml`.
- [ ] **Hourly brief trigger (until Pro):** add GitHub repository secrets
      `NEXUS_APP_URL` and `CRON_SECRET` so the hourly GitHub Action runs.
- [ ] **Clerk production instance** with your domain; swap in `pk_live_` /
      `sk_live_` keys. Configure Google as a sign-in provider there with
      your own OAuth credentials.
- [ ] **Supabase:** run `migrations/003-launch-hardening.sql` (fixes two
      tables missing row-level security). Move to a paid plan so the
      project doesn't pause, and turn on backups.
- [ ] **Fill in `lib/site.ts`** — legal entity name, contact and privacy
      emails, governing law — and have a lawyer review `/privacy` and
      `/terms`. They were written to match what the code does, but they
      are not legal advice.

## 2. Production environment (Vercel → Settings → Environment Variables)

- [ ] Every variable in `.env.local.example`, with production values.
- [ ] `NEXT_PUBLIC_APP_URL` = your real domain (used for redirects, OG
      tags, sitemap).
- [ ] `GOOGLE_REDIRECT_URI` = `https://<domain>/api/google/callback`, also
      added to the OAuth client's authorized redirect URIs.
- [ ] `TOKEN_ENCRYPTION_KEY` — if you already have `APPLE_ENCRYPTION_KEY`,
      use the **same value** (or keep only the old name). A new value locks
      out stored iCloud passwords.
- [ ] `CRON_SECRET` — long random string.
- [ ] Resend: verify your sending domain (SPF/DKIM) and set
      `BRIEF_FROM_EMAIL` on it.
- [ ] Anthropic: a production API key with a monthly spend limit set in the
      Console.

## 3. Strongly recommended before announcing

- [ ] Error monitoring (e.g. Sentry) and uptime checks on `/` and
      `/api/cron/brief` results.
- [ ] Test the full flow on the production domain with a fresh Google
      account: sign up → onboarding → connect Google → brief → chat action →
      undo → disconnect → delete account.
- [ ] Billing, if you plan to charge (not built yet — Stripe is the usual
      choice).
- [ ] Clean up local leftovers: `recommit2.sh`, `nexus-src.tgz`,
      `.ui-backup/`, `.backups/` (all now git-ignored except the script).

## Done in code (October 2026)

- Next.js 14 → **16.4** (critical security advisory in 14), React 19,
  Clerk 7, Anthropic SDK 0.137, ESLint 9 flat config. `npm audit`: 0
  production vulnerabilities.
- Models moved to **Claude Sonnet 5.5**. The five features that forced a
  tool call (brief, prep, drafts, filters, triage) now use structured
  outputs, since 5.5 rejects forced tool choice.
- Chat: per-message size cap; history always starts and ends on a user
  turn; final pass keeps tool definitions (the old version would 400).
- Google tokens **encrypted at rest** (AES-256-GCM), backward compatible.
  Disconnect now **revokes** the grant at Google.
- **Account deletion** in Settings — revokes access, deletes every row,
  deletes the Clerk user (required by Google's user-data policy).
- **Per-user rate limits** on every route that costs money per call.
- RLS fix for `brief_cache` / `brief_deliveries` (migration 003).
- Brief is triggered hourly (GitHub Action; Vercel cron daily fallback
  until Pro), matching the scheduler's design.
- Security headers, privacy and terms pages, 404 / error pages,
  `robots.txt`, `sitemap.xml`, Open Graph base URL.
- Clerk theme variables updated to the v7 names (the old ones were being
  silently ignored) and now type-checked.
- Tests: 125 passing (10 new).

## Done in code (later, October 2026)

- Voice: natural default voice (cedar), per-person voice choice with
  preview, warm conversational delivery, fewer seams, a more human spoken
  brief, automatic fallback before OpenAI's 2027-01-06 TTS shutdown, and
  the AI-voice disclosure OpenAI requires. `npm run voice:samples`;
  all four samples, including the fallback engine, checked by ear on
  2026-10-21.
- Google permissions narrowed from four restricted Gmail scopes to two
  (`gmail.modify`, `gmail.settings.basic`). In Google Cloud's consent
  screen, remove `gmail.readonly` and `gmail.compose` from the scope list.
- Fixed: editing an all-day event moved it a day early west of UTC;
  saving squashed multi-day events to one day; the add-event form's
  late-night defaults were rejected.
- Link-preview image, iOS home-screen icon, web manifest.
- Tests: 139 passing.

## Known follow-ups (not blocking)

- Contact email in `lib/site.ts` is a placeholder (`hello@nexus.app`).
- An unused `emails` table exists in Supabase; account deletion doesn't
  touch it. Decide whether to drop it.

- 25 lint warnings from React Compiler advisories — performance hints,
  not bugs.
- Tailwind 3 → 4 (clears two dev-only audit advisories).
- A full Content-Security-Policy (needs allowances for Clerk and the
  voice providers; test carefully).
