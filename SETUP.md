# Google integration setup

Follow these steps once before running the app. Both Supabase and Google
Cloud Console need a bit of configuration.

Google tokens live in one `google_tokens` table and are shared by every
Google API the app talks to (Gmail today, more later), so this setup is
done once rather than per-API.

## 1. Supabase

### 1a. Create the tokens table

Open your Supabase project → **SQL Editor** → **New query**, paste the
following, and run it:

```sql
create table if not exists public.google_tokens (
  user_id       text primary key,
  access_token  text not null,
  refresh_token text,
  token_expiry  timestamptz,
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

-- We authenticate with Clerk, not Supabase Auth, and only ever touch this
-- table from server routes using the service role key. RLS is enabled so
-- that anon/authenticated roles can't read tokens even by mistake — the
-- service role key bypasses RLS on purpose.
```

`user_id` stores the Clerk user id (e.g. `user_2abc...`) — it is `text`,
not `uuid`, because Clerk ids are prefixed strings.

### 1a-bis. Already have a `gmail_tokens` table?

If you set this project up before the table was generalized, rename it
in place rather than recreating it — this preserves existing rows, so
connected users stay connected:

```sql
alter table public.gmail_tokens rename to google_tokens;
alter table public.google_tokens enable row level security;
```

### 1a-ter. Apple Calendar credentials table

Apple has no OAuth for iCloud Calendar, so instead of a token we store an
Apple ID and an app-specific password the user generates themselves. Run
this alongside the table above:

```sql
create table if not exists public.apple_credentials (
  user_id      text primary key,
  apple_id     text not null,
  app_password text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.apple_credentials enable row level security;

-- Same reasoning as google_tokens: Clerk is the authority on identity and
-- only server routes touch this table with the service role key, which
-- bypasses RLS on purpose. RLS is on so anon/authenticated roles can't
-- read credentials even by accident.
```

`app_password` holds ciphertext, not the password — it's encrypted with
`APPLE_ENCRYPTION_KEY` (step 3) before it ever reaches Supabase.

### 1a-quater. Event prep checklists

Two tables: the checklist items themselves, and a record of which events
Claude has already drafted for.

```sql
create table if not exists public.prep_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  event_key     text not null,
  event_summary text,
  event_start   timestamptz,
  title         text not null,
  done          boolean not null default false,
  origin        text not null default 'user' check (origin in ('claude', 'user')),
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists prep_items_user_event_idx
  on public.prep_items (user_id, event_key);

create table if not exists public.prep_generations (
  user_id      text not null,
  event_key    text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

alter table public.prep_items enable row level security;
alter table public.prep_generations enable row level security;
```

`event_key` is not a calendar's own event id — it's `uid|start-instant`,
built in `lib/events.ts`. Google and Apple assign different ids to the
same meeting, and every instance of a weekly standup shares one UID, so
neither alone would work. `prep_generations` exists so an event whose
suggestions you deleted stays deleted instead of being redrafted on the
next load.

### 1a-quinquies. The action log

Every change Nexus makes to your account lands here — what it did, when,
and what it takes to undo it.

```sql
create table if not exists public.action_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  kind       text not null
               check (kind in ('draft_reply', 'archive', 'label', 'filter',
                               'trash', 'event_create', 'event_delete')),
  summary    text not null,
  target     jsonb not null default '{}'::jsonb,
  undo       text not null default 'none'
               check (undo in ('delete_draft', 'unarchive', 'remove_label',
                               'remove_filter', 'untrash', 'delete_event',
                               'restore_event', 'none')),
  undone_at  timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists action_log_user_created_idx
  on public.action_log (user_id, created_at desc);

alter table public.action_log enable row level security;
```

`target` holds whatever the undo needs — a draft id today, a list of
message ids once archive lands — so a new action type doesn't need a
migration. Rows are marked `undone_at` rather than deleted: "Nexus did
this and then you undid it" is part of the history the log exists to
show.

### 1a-sexies. The onboarding profile

What the user told Nexus about themselves in the first-run interview.
One row per user, every field nullable — a half-finished interview is a
normal state.

```sql
create table if not exists public.user_profile (
  user_id             text primary key,

  -- core interview
  role_description    text,
  sector              text,
  sector_other        text,
  vips                text[],
  current_focus       text,
  noise_filters       text[],
  morning_time        text,
  timezone            text,
  news_preferences    text[],
  brief_wishlist      text,

  -- optional: communication style
  draft_tone          text,
  urgency_style       text,

  -- optional: company context
  company_description text,
  company_stage       text,
  team_size_range     text,

  -- optional: work rhythms
  quiet_hours         text,
  weekend_contact     text,

  -- not from the interview: the chat card's "read replies aloud" toggle
  voice_replies       boolean,

  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.user_profile enable row level security;
```

Already have the table from before voice shipped? One column, and no
backfill — a null reads as muted, which is the default anyway:

```sql
alter table public.user_profile
  add column if not exists voice_replies boolean;
```

The row's *existence* is what stops the dashboard redirecting someone
back into the interview — `completed_at` only distinguishes "finished
it" from "skipped it". That split is deliberate: skipping is a real
answer, and a user who skipped shouldn't be asked again on every visit.

Choice fields (`sector`, `draft_tone`, `company_stage`, and so on) are
plain `text` rather than enums or check constraints on purpose. The
allowed values live in `lib/onboarding-questions.ts` and are enforced
there on write; keeping the database permissive means adding a sector
is a one-line code change instead of a migration.

`morning_time` is `text`, not `time` — it's paired with `timezone` and
only ever read back as a string for the prompt, so storing it as a wall
clock value the user recognizes beats a typed column that needs
converting at both ends.

**Already ran an earlier version of this table?** The filter actions
added two `kind` values and two `undo` values, so the old constraints
have to be replaced:

```sql
alter table public.action_log drop constraint if exists action_log_kind_check;
alter table public.action_log add constraint action_log_kind_check
  check (kind in ('draft_reply', 'archive', 'label', 'filter', 'trash',
                  'event_create', 'event_delete'));

alter table public.action_log drop constraint if exists action_log_undo_check;
alter table public.action_log add constraint action_log_undo_check
  check (undo in ('delete_draft', 'unarchive', 'remove_label',
                  'remove_filter', 'untrash', 'delete_event',
                  'restore_event', 'none'));
```

### 1a-nonies. What Nexus remembers

Short facts Nexus infers about the user while it writes their brief.
This is ROADMAP.md's memory layer, and the columns are the roadmap's
three rules made structural: a source that can't be null, an expiry, and
rows a user can really delete.

```sql
create table if not exists public.user_facts (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  category     text not null check (category in
                 ('person', 'deadline', 'project', 'preference')),
  fact         text not null,
  -- the message id or event key this was read out of. Not null on
  -- purpose: a fact with no source can't be checked, and an
  -- unfalsifiable claim in a prompt is what this table exists to avoid.
  source_id    text not null,
  source_label text,
  source_kind  text,
  -- null means "no reason to think this stops being true" (who someone
  -- is). A date means it rots — every deadline gets one, whether or not
  -- the model supplied it.
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists user_facts_user_created_idx
  on public.user_facts (user_id, created_at desc);

alter table public.user_facts enable row level security;
```

Rows are deleted, never flagged. "Every fact is visible and deletable"
means nothing if forgetting leaves the row behind.

### 1b. Grab the environment variables

In Supabase → **Project Settings** → **API**, copy:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **`service_role` secret** → `SUPABASE_SERVICE_ROLE_KEY`
  (Server-only. Never expose it to the browser.)

## 2. Google Cloud Console

### 2a. Create / pick a project

Go to <https://console.cloud.google.com/> and either select an existing
project or create a new one (top-left project dropdown → **New project**).

### 2b. Enable the Google APIs

- Navigation menu → **APIs & Services** → **Library**
- Search for **Gmail API**, open it, click **Enable**.
- Do the same for **Google Calendar API** and **People API**.

### 2c. Configure the OAuth consent screen

- **APIs & Services** → **OAuth consent screen**
- User type: **External** (unless you're on a Workspace org that wants
  Internal).
- App name: `Nexus` (anything you like), user support email, developer
  contact email. Save & continue.
- **Scopes**: click **Add or remove scopes** and add:
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/calendar.readonly`
  - `https://www.googleapis.com/auth/gmail.compose`
  - `https://www.googleapis.com/auth/gmail.settings.basic`
  - `https://www.googleapis.com/auth/gmail.modify`
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/contacts.readonly`
  - `https://www.googleapis.com/auth/contacts.other.readonly`

  `gmail.compose` lets Nexus create drafts. It deliberately does **not**
  include `gmail.send` — a draft that can't leave your account without
  you opening Gmail is the entire safety argument for this feature.

  `gmail.settings.basic` creates filters; `gmail.modify` moves existing
  mail to Trash when you sweep a backlog. Neither is `gmail.delete`, and
  there is no code path in this app that permanently deletes a message —
  everything Nexus removes lands in Trash, where Gmail holds it for 30
  days.

  `calendar.events` adds and deletes calendar events. It's the widest
  thing here, because a deleted meeting can email its guests and no undo
  un-sends that. See §4f for the guards around it.

  The two `contacts` scopes power the guest picker and are both
  read-only. `contacts.other.readonly` covers people the user has emailed
  but never saved — which is where most of the addresses anyone actually
  invites live.
- **Test users**: while the app is in Testing mode, add your own Google
  account (and anyone else who'll test) here. Save.

### 2d. Create the OAuth client

- **APIs & Services** → **Credentials** → **Create credentials** →
  **OAuth client ID**
- Application type: **Web application**
- Name: `Nexus web`
- **Authorized JavaScript origins**:
  - `http://localhost:3000`
  - (add your production origin later, e.g. `https://your-domain.com`)
- **Authorized redirect URIs**:
  - `http://localhost:3000/api/google/callback`
  - (add the production equivalent later, e.g.
    `https://your-domain.com/api/google/callback`)
- Create. Copy the **Client ID** and **Client secret**.

## 3. Environment variables

Copy `.env.local.example` to `.env.local` and fill in the highlighted
lines:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...          # from step 1b
SUPABASE_SERVICE_ROLE_KEY=...         # from step 1b (server-only)

# Google OAuth
GOOGLE_CLIENT_ID=...                  # from step 2d
GOOGLE_CLIENT_SECRET=...              # from step 2d
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback

# Apple Calendar
APPLE_ENCRYPTION_KEY=...               # openssl rand -base64 32

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Alpha Vantage (optional — only powers the news section of the brief)
ALPHA_VANTAGE_API_KEY=...              # from step 3b
```

### 3b. News in the brief (optional)

Skip this if you don't care about the "financial markets / industry news
/ general headlines" onboarding question actually doing anything — the
app runs fine without it, that question just stores a preference nothing
reads yet.

1. Go to <https://www.alphavantage.co/support/#api-key> and request a
   free key — no credit card, arrives immediately.
2. Put it in `ALPHA_VANTAGE_API_KEY`.

One key covers all three onboarding options. Alpha Vantage's
`NEWS_SENTIMENT` endpoint takes a `topics` filter, and "financial
markets", "industry news", and "general headlines" all turn out to be
the same call with a different topic — see `lib/news.ts` for the mapping
from sector to topic.

The free tier is rate-limited (25 requests/day at the time of writing).
That's fine for one developer testing locally, but it's the first thing
to hit if this ships to real users — `lib/news.ts` caches each fetch for
10 minutes to stretch it, and logs (rather than fails the brief) when the
quota's used up for the day, so a rate limit degrades the news section
quietly instead of breaking the brief.

Claude never sees this key or calls Alpha Vantage itself — the route
fetches real articles first, hands Claude only their titles and
summaries, and then throws out anything Claude returns that doesn't
match a title it was actually given. That check lives in
`resolveNewsHighlights` in `app/api/brief/route.ts`; it's the reason a
user can't end up seeing a headline that was never real.

`GOOGLE_REDIRECT_URI` must match one of the Authorized redirect URIs on
the OAuth client exactly, path included. Google rejects the connect flow
with `redirect_uri_mismatch` otherwise.

`APPLE_ENCRYPTION_KEY` must decode to 32 bytes — base64 or hex both work.
Generate it once and keep it: rotating it makes every stored Apple
password unreadable, and everyone connected has to enter a new one.

Restart the dev server after editing `.env.local`.

## 4. Try it

1. `npm run dev`
2. Sign in, visit `/dashboard`.
3. Click **Connect Gmail** — you'll be sent to Google, grant permission,
   and land back on the dashboard.
4. Your 20 most recent emails should appear, and your next 7 days of
   events below them. Use **Refresh** on either card to re-fetch.

If Google returns `access_denied`, the app will show a friendly banner
instead of crashing. Same for any Gmail or Calendar API failure at fetch
time.

## 4b. Connecting Apple Calendar

There's no redirect to click through — Apple doesn't publish an OAuth
flow for iCloud Calendar, only CalDAV with an app-specific password. On
the Upcoming card, **Connect Apple** opens a short form. Before filling
it in:

1. Sign in at <https://appleid.apple.com/account/manage>
2. **Sign-In and Security** → **App-Specific Passwords**
3. Generate one, name it `Nexus`
4. Copy it — Apple shows it once (`abcd-efgh-ijkl-mnop`)

Paste that plus the Apple ID email into the form. `/api/apple/connect`
checks the credentials against `caldav.icloud.com` before saving, so a
typo fails immediately rather than turning into an empty calendar later.

Apple events then merge into the same Upcoming list, the Morning Brief,
and Chat. Nothing downstream distinguishes them: `gatherEvents` in
`lib/calendar-sources.ts` fetches both services in parallel and returns
one sorted list, deduped on iCalendar UID so a meeting that lives on both
a Google and an iCloud calendar appears once.

## 4c. Prep checklists

Every event on the Upcoming card expands into a checklist of what has to
happen before it. Click **Prep** on a row, then **Draft with Claude** —
it reads the event (title, attendees, location) plus any of your recent
mail that looks related, and proposes up to six concrete items. Edit
them, tick them off, add your own, delete what's wrong.

Drafting runs once per event and is never automatic: it costs a model
call, and redrafting on every page load would fight your edits.
**Redraft** replaces Claude's untouched suggestions only — anything you
typed or already ticked off survives.

Unfinished items on today's and tomorrow's events are passed to the
Morning Brief as context, so it can lead with what isn't ready rather
than just listing meetings.

## 4d. Draft replies

Click any message in the Inbox card to expand it, then **Draft reply**.
Nexus reads the whole thread — not just the one message — and writes a
reply into your Gmail drafts. **Tell it what to say** adds a one-line
instruction first ("decline politely", "ask for the deck"); leave it
blank and it infers what the reply owes the thread.

Nothing is sent. The draft sits in Gmail until you open it, and
**Discard** deletes it from your account rather than just clearing it off
the screen. That's the shape every action Nexus takes will follow:
propose, approve, execute — with the approval step never skipped.

Two things make the draft thread correctly rather than starting a
parallel conversation with the same subject: Gmail's own `threadId` on
the draft, and the `In-Reply-To` / `References` headers copied from the
newest message, which is what every other mail client keys off once it's
sent.

Every draft is written to `action_log` with the draft id, so the log page
can show it and **Discard** knows what to remove.

## 4d-bis. Tidy up (archive and label)

**Scan my inbox** reads your 40 most recent inbox messages and points at
the ones that were never going to need you — newsletters, receipts,
automated notifications. Every pick carries a short, specific reason
("Weekly Medium digest", not "looks like a newsletter"), because a list
of 14 subject lines is something you either trust blindly or ignore.

Boxes start checked and unchecking is the point: you're approving a
proposal, not confirming a decision already made. Optionally apply a
label on the way out — pick an existing one or type a new name.

**This is the batchable action, and it's allowed to be.** Archiving in
Gmail is just removing the `INBOX` label: the message is untouched, still
searchable, still in every thread it was in, and putting `INBOX` back is
a complete reversal. Compare the trash sweep in §4e, which is capped,
previewed, and deliberately harder to fire.

The classifier is biased toward keeping. It's told never to propose
security alerts, password resets, billing failures, anything asking a
question, or anything from a person writing directly to you. The
`List-Unsubscribe` header is passed as *evidence* of a mailing list, not
obeyed as a rule — plenty of mail people care about is sent that way.

Two log entries are written, not one: the label and the archive. Undoing
the archive puts the mail back in the inbox and leaves the label alone,
which is usually what you want. Removing a label strips it from those
messages only — the label itself survives, since deleting it would affect
everything else that carries it.

## 4e. Filters

The Filters card takes a plain description — "Medium newsletters",
"LinkedIn notifications" — and turns it into a native Gmail filter that
sends matching mail straight to Trash.

**Nothing is created without a preview.** Describe the mail, click **See
what it catches**, and Nexus shows you a sample of messages already in
your mailbox that the rule would have caught, plus Gmail's estimate of
the total. That middle step is not skippable, and it's the reason this
feature is safe to ship: a filter runs unsupervised afterwards, so it has
to earn that by being checked against real mail first.

Two things are separate on purpose:

- **Turning the rule on** only affects mail that arrives from now on.
  That's how Gmail filters work, and pretending otherwise would surprise
  people.
- **Sweeping the backlog** is its own checkbox, capped at 200 messages
  per run, logged as its own action with the message ids it moved. Undo
  restores exactly those, not whatever else is in Trash.

**Nothing is permanently deleted, ever.** Filters add the `TRASH` label;
Gmail keeps trashed mail for 30 days. Nexus never asks for `gmail.delete`
and has no code path that bypasses Trash.

Two guards sit in front of filter creation, and both run on the server
regardless of what the browser sends:

- Criteria matching a whole public mail domain (`gmail.com`,
  `outlook.com`, and similar) are rejected outright.
- A rule defined only by age (`older_than:1y` with no sender or subject)
  is rejected — it would eventually catch everything.

Claude is prompted to read descriptions narrowly and to flag anything it
had to guess; that flag shows up in amber above the preview. Prefer a
rule that misses some junk over one that catches a client's email.

**Turn off** on an active rule stops it acting on future mail. It does
not restore anything already trashed — that's the sweep's undo, which is
a separate row in the action log for exactly this reason.

## 4f. Adding and deleting events

**+ Add an event** sits under the Upcoming list. Title, date, time or
all-day, optional location, optional guests, and — required — which
calendar it goes on.

**The calendar picker starts empty and the form won't submit without
it.** There's no default. Defaulting to a primary calendar saves one
click and produces a steady trickle of events filed somewhere the user
didn't mean; on a shared calendar, everyone with access has seen it
before the mistake is noticed. The button reads "Pick a calendar" until
one is chosen, then "Add to Work".

The dropdown is grouped by service and lists **writable** calendars
only. The Upcoming list is built from everything *readable* — subscribed
holiday feeds, a colleague's shared calendar — and offering those as
targets would mean a dropdown where half the choices fail on submit. On
the Google side that means `accessRole` of `owner` or `writer`; on the
Apple side, event collections that aren't subscribed feeds.

Because the event is written to a real calendar on a real account, it
syncs the way anything else on that calendar does — a Google calendar
appears on any device signed into that account, an iCloud calendar on
anything signed into that Apple ID. Nexus doesn't do the mirroring; it
just puts the event somewhere that already mirrors.

**Repeating events.** The dropdown under the date covers the common
cases — daily, weekly, every 2 weeks, monthly, yearly — and **Custom…**
opens an interval, weekday toggles for weekly rules, and an end
condition (never, after N times, or on a date).

Whatever you build is echoed back as a sentence before you commit:
"Every 2 weeks on Tuesday and Thursday, until 3 March 2027". That
readback is the check that catches a rule which fires 200 times before
it's created, rather than after.

One rule is built and handed to both services. Google takes it as an
`RRULE` string in its `recurrence` array; Apple takes the same string as
a line inside the VEVENT. Building it once matters — a standup that
repeats correctly on Google and wrongly on iCloud is worse than one that
doesn't repeat at all. Intervals are capped at 52 and occurrence counts
at 730, so a typo can't produce something pathological.

**Deleting a repeating event asks which.** Rows that recur are marked
"Repeats", and the confirm dialog offers *just this one* or *every
occurrence, past and future*. It defaults to just this one — the smaller
act, and what someone clicking Delete on a single row usually means.
There's no safe default that's right for both, which is why it asks
rather than guessing. Deleting a series clears every one of its rows
from the list, not only the row that was clicked.

Undo restores the series with its rule intact: the snapshot keeps
Google's own `RRULE` strings verbatim rather than parsing them back
through Nexus's model, so a rule using something the model doesn't cover
survives the round trip. Undoing a single deleted occurrence brings it
back as a standalone event — that one is a genuine limitation, not a
bug.

**Find a time for me** sits under the time fields. Pick a length and a
window, and Nexus proposes slots that are actually free across every
calendar it can read — Google via its freebusy endpoint, iCloud derived
from the events it already fetches, since CalDAV has no freebusy. Add
guests first and their calendars are checked too.

It stops short of booking. Picking a slot fills in the date and time on
the form; you still press Add. Proposing a time and putting it on
someone's calendar are separate steps on purpose — a one-click "hold
this" that quietly appeared on a guest's calendar would be a different
promise than this app makes anywhere else.

**A guest whose calendar Nexus can't see is reported, not assumed free.**
Google returns an error rather than data for a calendar the user has no
access to, which would otherwise read identically to "wide open". Those
names are listed in an amber note above the slots, saying the times only
account for your own calendar.

Slots land on quarter-hour boundaries and are spaced at least an hour
apart. 10:00, 10:15 and 10:30 are one option presented three times, not
three options. All-day events block the whole day — someone with "Annual
leave" on isn't available at 2pm.

**Guests are picked, not typed from memory.** Start typing a name and
the field searches both your saved contacts and everyone you've emailed
without saving — the second source is where most real invitees live, so
searching the address book alone would produce a picker that knows
almost nobody. Chosen guests become removable chips rather than free
text, so a stray backspace can't turn an address into a malformed one.

A typed address always works regardless. Suggestions are a convenience
layered on top, never a gate: someone you've never emailed, or a lookup
that came back empty, is invited by typing the address and pressing
Enter. Every failure in `/api/contacts` returns an empty list rather
than an error for exactly this reason — a red banner over a working
feature is noise.

One quirk worth knowing: Google's contact search indexes start cold and
the first query after a gap returns nothing. Nexus sends a warm-up call
when the guest field is first focused, which is Google's own documented
fix. If suggestions seem empty on the very first try, they won't be on
the second.

Guests are the only field that reaches other people, so the button says
what it's about to do — "Add and invite 3" rather than just "Add" — and
invites go out only when guests are actually named. Undo removes the
event again.

**Guests don't work on iCloud calendars.** Sending invitations over
CalDAV means iTIP scheduling, where the server mails guests on the
organizer's behalf, and iCloud handles that inconsistently from a
third-party client. Rather than dropping the guest list silently, the
guest field disables when an iCloud calendar is selected and the route
refuses the request with `code: "guests_unsupported"`. Put it on a
Google calendar, or add it without guests.

**Delete** appears on each Google event row and never fires on one click.
Confirming shows how many other people are on the event and offers a
separate checkbox for whether to email them a cancellation. That
checkbox defaults to **off**: leaving it off removes the event from your
calendar without touching anyone else's copy, which is the recoverable
version of the mistake.

Three rules hold here, and they're the reason this ships last:

- **Never batched.** One event, one confirmation. There is no bulk
  delete endpoint and there shouldn't be — the roadmap's rule is that
  irreversible actions are individual and explicit, and a cancellation
  email is as irreversible as this app gets.
- **Quiet by default.** `sendUpdates` is `"none"` unless the user ticks
  the box. Guests finding out is a decision, not a side effect.
- **Snapshot before delete.** The event is read back and stored in the
  action log first, so undo can recreate it.

**What undo actually gets back.** The meeting returns with the same
title, time, location, description, and guest list — but a *new* event
id. Anything keyed to the old id (its prep checklist, a guest's own copy
of the invite) doesn't reattach, and a cancellation email already sent
stays sent. The confirm dialog says "Undo brings it back as a new event"
rather than implying a clean rollback.

**Apple events have no Delete button, even now that Apple is writable.**
Deleting over CalDAV needs the event's object URL — the `.ics` resource
path — and events fetched from iCloud don't carry it through the parse
path. Nexus only has that URL for events it created itself, which is why
**Undo** works on a freshly added iCloud event while **Delete** on an
arbitrary one does not. The row's `calendarId` stays null and the delete
route refuses it with `code: "unsupported_source"` rather than guessing
at a URL. Remove those in the Calendar app.

**When it breaks.** App-specific passwords don't expire, but they can be
revoked from Apple's site, and there's no refresh flow to fall back on
the way OAuth has. The calendar route reports `apple: "auth_failed"` and
the card prompts for a new password. Disconnecting in Nexus only deletes
our copy — revoke it at appleid.apple.com to kill it for good.

## 4g. What the onboarding interview actually changes

The interview at first sign-in writes one `user_profiles` row. Every
answer in it is now read by something — that wasn't true when the
interview shipped, and if you add a question, add a consumer with it or
you're asking for information you don't use.

**Where the profile is read.** Five places, all failing soft: an
unreadable profile logs and drops through to the un-personalized
behavior, so no feature depends on the interview having been finished.

| Surface | Reads | What it does with it |
| --- | --- | --- |
| Morning brief | `profileToPromptContext` + `morning_time` + `news_preferences` | What to lead with, which news to pull, what hour to write for |
| Chat | `profileToPromptContext` | Answers "what matters today?" with the same idea of *who matters* the brief has |
| Draft replies | `profileToDraftContext` | Voice: `draft_tone`, `urgency_style`, role, company |
| Triage | `profileToPromptContext` + explicit rules | `noise_filters` as a bias toward archiving, `vips` as a hard rule |
| Prep checklists | `profileToPromptContext` | What a meeting needs preparing depends on what the user does |

There are two prompt-context functions on purpose. `profileToPromptContext`
is written for a model deciding *what to surface* — it says things like
"never bury this person", which is meaningless to a model composing a
reply. `profileToDraftContext` is written for a model *writing as the
user*: identity and register, nothing else.

**VIPs are enforced twice.** The triage prompt is told not to propose
archiving them, and `lib/triage.ts` then drops any proposal whose sender
matches the VIP list before the user ever sees it (`matchesVip`). The
prompt is advice; the code is the guarantee. This asymmetry is
deliberate — the noise list only ever costs the user an extra glance if
the model gets it wrong, but the VIP list is the promise that a message
someone is waiting on doesn't get archived, and that can't rest on a
judgement call.

Matching is loose on names and strict on addresses: `"Sarah Chen"` finds
`sarah.chen@acme.com`, but `dana@acme.com` matches only that address, not
`dana@newsletter.acme.com`. Terms under three characters are ignored — an
initial would match half an inbox. When anything is protected, the Triage
card says so ("Left 2 messages alone — they were from someone on your
list of people who matter"), because a protection nobody can see is one
nobody has reason to trust.

**Timezones.** `lib/clock.ts` is the only thing that should answer "what
day is it for this user". Serverless hosts run in UTC, so
`Intl.DateTimeFormat().resolvedOptions().timeZone` resolves to UTC no
matter who is asking — before this, the brief's "today or tomorrow" event
window silently shifted forward a day for anyone reading after 8pm
Eastern. `resolveTimezone` prefers the interview's answer and falls back
to the host; `nowLines` produces the "Today is…" preamble every prompt
opens with. Don't reach for `toDateString()` in a prompt — it's the
server's day, not theirs.

**Still unused by anything that runs on a schedule:** `quiet_hours` and
`weekend_contact` only reach the model as prompt context today, because
nothing yet sends without being asked. They become real constraints when
the brief starts being delivered rather than fetched.

### 1a-septies. The brief cache

The brief is the most expensive thing this app does — a model call over
the whole inbox and calendar, twelve to twenty seconds, several cents.
Without this table every dashboard load paid for it again, and React's
development double-render made that twice per load.

```sql
create table if not exists brief_cache (
  user_id text not null,
  -- The user's calendar day in their own timezone, YYYY-MM-DD. Keyed on
  -- their day rather than a UTC one, or the cache would expire
  -- mid-evening for anyone west of London.
  day text not null,
  brief jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
```

No RLS policy is needed — every read and write goes through the service
role key from a route that has already checked Clerk's session, the same
as every other table here.

**How it behaves.** A page load reads the stored brief and spends no
model call. The **Rewrite** button calls `/api/brief?refresh=1`, which
regenerates from current mail, calendar and markets and overwrites the
day's row. Yesterday's rows are deleted on the next write, so there's no
scheduled job to forget about.

**The tradeoff worth knowing.** This is a whole-day cache, not a short
TTL. Mail that arrives after the brief was written won't appear in it
until you hit Rewrite. That's deliberate — a morning brief is a
point-in-time artifact, and one that quietly rewrote itself every time
the tab regained focus would be both expensive and disorienting. If that
turns out to be wrong, the fix is a staleness check on unread count
rather than a shorter TTL.

**Four rules that keep the cache from lying.**

- **A degraded brief is never stored.** If the calendar, the feeds or the
  quotes were unavailable when it was written, it is served once and
  regenerated next load. Cached, a 7am calendar blip would have shown
  "your calendar wasn't available this morning" for the next seventeen
  hours, with the calendar working fine the whole time.
- **Quotes are refreshed on every cache hit.** The prose is timestamped
  and stays as written; prices are the one part that goes stale in a way
  the reader can't see, so the tiles get a fresh batched quote request —
  itself cached five minutes — while the paragraph keeps its "Written
  7:04 AM" label.
- **The day is the user's day.** Keyed on `profile.timezone`, falling
  back to the browser's zone (sent as `?tz=`) rather than the host's.
  A UTC host would otherwise roll the key over at 5pm Pacific.
- **Only today's row survives.** The prune deletes every day that isn't
  today, not merely older ones — moving timezone west shifts the key
  backwards, and an older-than prune would strand the future-dated row to
  be served as a morning brief once the date caught up.

**Still open, and deliberate.** Two serverless instances missing at the
same instant can both generate; the in-process guard only dedupes within
one instance, which is what a double-render or a second tab actually
hits. A cache hit also skips the Google-connected check, so revoking
access mid-day leaves the stored brief readable until Rewrite.

### 1a-octies. Scheduled brief deliveries

One row per brief actually emailed. This is the only thing standing
between a retried or overlapping cron run and a duplicate — and an
assistant that emails you the same brief twice is one you filter into a
folder.

```sql
create table if not exists brief_deliveries (
  user_id text not null,
  day text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, day)
);
```

The primary key is doing real work here: the scheduler *claims* a
delivery by inserting before it generates anything, so if two runs
overlap, both check, both may see nothing, and only one insert survives.
A claim is released if generation or sending then fails, which lets the
next hourly run try again.

## 5. Re-consenting after a scope change

Google grants scopes at connect time and bakes them into the stored
token. Adding a scope to `GOOGLE_SCOPES` does **not** widen a token that
already exists — anyone connected before the change keeps the narrower
grant until they go through consent again.

This has now happened several times: Calendar after Gmail,
`gmail.compose` after both, `gmail.settings.basic` + `gmail.modify`
after that, then `calendar.events`, and most recently the two `contacts`
scopes. Anyone connected before a given change keeps the narrower grant
until they reconnect.

Every route that needs a scope checks the stored scope string before
calling Google and returns `code: "scope_missing"` rather than letting
Google throw a 403 — `/api/gmail/draft` for compose, `/api/gmail/filters`
for settings, the backlog sweep for modify, and
`/api/calendar/events/create` plus the delete route for
`calendar.events`. The UI renders that as a **Reconnect** link on the
affected card. Reading mail and calendar keeps working throughout.

`/api/contacts` is the exception: a missing scope there returns an empty
list rather than a `scope_missing` code, because the guest field still
accepts typed addresses and nagging about a degraded autocomplete would
cost more than it's worth.

Calendar was added after Gmail, so every account connected before then
is in exactly this position. The app detects it: `/api/calendar/events`
checks the stored scope string before calling Google and returns
`code: "scope_missing"`, which the dashboard renders as a **Reconnect to
enable Calendar** prompt on the Upcoming card. The inbox keeps working
throughout.

Clicking that prompt runs the normal connect flow. `/api/google/connect`
sends `prompt: "consent"`, so Google re-shows the permission screen
rather than silently reissuing the old grant, and the new token comes
back covering both scopes.

The same applies to any scope added later: append it to `GOOGLE_SCOPES`,
add it to the consent screen in step 2c, and existing users reconnect
once.

## 6. The scheduled morning brief

Everything else in Nexus happens when you open the dashboard, which makes
it a website you have to remember to visit. This is the part that shows
up on its own.

### 6a. What it does

A cron hits `GET /api/cron/brief` **every hour**. Hourly rather than "at
7am" because 7am is a different instant for every user — the schedule is
per-person, read from `morning_time` and `timezone` in their profile,
which the onboarding interview has been collecting all along and nothing
used until now.

Each run sends to whoever's morning has just arrived. The bar for putting
something in someone's inbox unasked is high, so every guard fails toward
silence:

- Only users who **finished** the interview and chose a morning time. An
  unfinished interview means they never picked an hour, and sending at a
  default would be Nexus deciding to email someone who hadn't asked.
- Only in the hour matching that time **in their zone**, plus a
  three-hour grace window. The window is what makes failures survivable:
  without it the schedule is a single instant, so one Anthropic 503 at
  7am means no brief that day. It also covers the spring-forward hole —
  a `morning_time` of 02:00 has no 2am on that date.
- **Never without a timezone.** A morning time with no zone isn't a
  time; guessing means emailing a Los Angeles user at midnight on a UTC
  host and calling it their morning. Those users are skipped until they
  set one.
- Never twice in a day, even if the job overlaps, retries, or the
  container restarts mid-run.
- Never on a weekend for anyone who answered "never" to weekend contact.
- **Never during an outage.** A brief built while the calendar or the
  feeds were down is fine to show someone who asked for it and not fine
  to push at them; the claim is released and the grace window catches it
  an hour later. Note this means *outages only* — a missing
  `TWELVE_DATA_API_KEY` is a permanent fact about the deployment, not a
  blip, so it sends and the brief says what's missing. Treating the two
  alike silently cancelled the brief forever for anyone who ticked
  financial news.
- **Never twice, even when the send is ambiguous.** A provider timeout
  may or may not have delivered, so the duplicate guard is *kept* rather
  than cleared. That risks one missed brief; clearing it would risk two
  identical emails, which is the failure that gets an assistant muted.

### 6b. Environment

```bash
RESEND_API_KEY=            # https://resend.com — free tier is 3,000/month
BRIEF_FROM_EMAIL=Nexus <brief@yourdomain.com>   # domain must be verified
CRON_SECRET=               # any long random string
```

Without `RESEND_API_KEY` and `BRIEF_FROM_EMAIL` the route answers 503 and
sends nothing. Without a matching `CRON_SECRET` it answers 401 — that
check is not optional, because an open route here lets a stranger make
you pay for a model call per request.

### 6c. Why not send from the user's own Gmail

It would need the `gmail.send` scope, which `lib/google.ts` excludes on
purpose. A token that can send mail as someone is a far larger thing to
hold than one that can only draft, and widening that scope for a
convenience is the kind of trade that's hard to walk back. A brief that
arrives *from Nexus* is also more honest than one that appears to be from
yourself.

### 6d. Deploying the schedule

`vercel.json` declares the hourly cron. Vercel reads it on deploy; there
is nothing to configure in the dashboard. On the Hobby plan cron runs are
once-daily and the timing is approximate, so an hourly schedule needs a
Pro plan — on Hobby, either accept one fixed hour for everyone or point
an external scheduler (GitHub Actions, cron-job.org) at the same URL with
the same Bearer token.

### 6e. Testing it without waiting for morning

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/brief
```

It answers with what it did — `{"due":1,"deferred":0,"outcomes":{"sent":1}}`
— so an empty `due` tells you the hour didn't match rather than leaving
you guessing. To force a send, set your `morning_time` to the current
hour in settings first.

`deferred` is non-zero when a run ran out of its time budget. Deliveries
are sequential (each is a model call, and firing the whole list at once
would spike every upstream limit at the top of the hour), so a run stops
starting new ones with a minute to spare — being killed mid-delivery is
the one way a user gets marked delivered without receiving anything. The
list is sorted and then rotated by the hour, so a run that runs out
doesn't drop the same people every single day.

## 7. Tests

```bash
npm test
```

Compiles `lib/` and runs Node's built-in test runner over `tests/`.

**No test framework is installed, on purpose.** Node 22 ships `node:test`
and `node:assert`, and TypeScript is already a dependency — so the whole
setup is one config file (`tsconfig.test.json`) and one script, with no
new supply chain to keep patched. It also means tests run on a machine
with no network access, which the development VM doesn't have.

**Only `lib/` is compiled.** Route handlers and components need a Next.js
runtime to mean anything; the logic worth testing was deliberately kept
out of them. When something in a route turns out to be worth a test, the
move is to lift it into `lib/` first — which is exactly why
`lib/schedule.ts` exists apart from the cron route that uses it.

**What's covered, and why those things.** Every case in `tests/` is a bug
that actually happened, not a hypothetical:

| File | Guards against |
| --- | --- |
| `vips.test.cjs` | The VIP list failing in both directions — missing "my co-founder Marcus" (the format onboarding suggests), and "Ann" protecting `announcements@` |
| `schedule.test.cjs` | Emailing twice across midnight, skipping the day 2am doesn't exist, and treating a Friday-night retry as Saturday |
| `rss.test.cjs` | Nine ways a real publisher's feed broke the hand-rolled parser |
| `news-preferences.test.cjs` | A retired onboarding option silently switching news off for existing users |
| `memory.test.cjs` | A fact citing a message the model was never shown, a deadline that never expires, and the same fact being re-learned every morning |
| `speakable-text.test.cjs` | Markdown being read out literally — "star star Sarah star star", a URL spelled character by character |

The bias is toward parsing and decisions — the places where being subtly
wrong looks exactly like working correctly. There is deliberately no
coverage of "does Supabase return a row": that tests the library, needs a
live connection, and has never been the thing that broke.

## 8. What the chat box can do

Chat used to describe actions it couldn't take: a dozen working action
routes sat beside a box that could only answer questions about them. It
can now draft a reply, archive, and label — "draft Sarah a decline",
"archive the newsletters", "label those Receipts".

**Only reversible things, and that is the whole design.** ROADMAP.md's
rule is that reversible actions can be batched while irreversible ones are
always individual, always explicit, and always previewed in full. A
conversation is not a preview, so chat gets the reversible half and
nothing else. Absent on purpose, not by oversight:

- **Sending mail.** Nexus has never held the `gmail.send` scope and this
  is not the feature that should introduce it.
- **Deleting or trashing.**
- **Creating calendar events** — they notify other people, which makes
  them irreversible in the way that matters: the invitation has already
  arrived.

Asked for one of those, it says it has to be done from the dashboard
rather than pretending.

**Three guards worth knowing.**

- **It can only touch what it was shown.** Every id is checked against
  the messages actually included in this turn's context, so an invented
  id can't reach Gmail and a message the user never saw can't be acted
  on.
- **Three actions per turn, then it must answer.** On the final pass the
  tools are withheld rather than the model being cut off mid-sentence —
  a budget spent by truncation would leave the mailbox changed and the
  explanation missing.
- **Every action is logged with its undo**, and the receipt appears
  under the message that claimed it. "I archived those" is a claim; the
  line beneath it with an Undo button is the proof.

**One trap, since it cost a bug already.** An action's `target` is a
`Record<string, string>`, so the compiler cannot tell `ids` from
`messageIds` — and chat's archive tool wrote the wrong one. Every Undo it
offered answered 422, and the button reported nothing. Writers and the
undo route now share `actionTarget` / `readMessageIds` in `lib/actions.ts`
and `tests/action-targets.test.cjs` holds the two ends together. If you
add an action kind, go through those helpers rather than writing the keys
by hand.

## 8b. Talking to it, and it talking back

Chat has a mic button and can read its answers aloud. Both halves use the
browser's own Web Speech API — `SpeechRecognition` for the mic,
`speechSynthesis` for the voice — wrapped in `app/dashboard/useSpeech.ts`.

**No key, no cost, no audio through Nexus.** This is the reason for the
choice. A hosted transcription service would be more accurate and a
hosted voice would sound better, but "we also stream your microphone to a
third party" is a much larger ask from an app that already reads your
mail. (Chrome's implementation does send audio to Google for
transcription — that's the platform, not Nexus, and it's the same trade
already made by using Chrome's own voice input.)

**Push-to-talk, not hands-free, and that is the safety model.** The
transcript lands in the ordinary chat input and the user still presses
Send. Nothing about the request to `/api/chat` changes, so every guard in
section 8 applies unchanged — and, more to the point, a mis-heard
"archive the newsletters" sits in an editable box instead of executing.
Auto-send on silence is the obvious next feature and the one that would
undo this.

**Firefox has no `SpeechRecognition`, so the button doesn't render.**
Feature-detected in an effect rather than at render, because the server
has no `window` and a first paint that disagrees with the client is a
hydration mismatch. The one error worth surfacing is `not-allowed` — a
blocked mic is fixable and the fix isn't discoverable; `no-speech`,
`aborted` and `network` are ordinary ends to a mic session and return to
idle silently.

**Speaking is muted by default and stored in the profile.**
`user_profile.voice_replies`, toggled from either the chat card or
settings, not localStorage — preferences in Nexus follow the user across
devices. An app that starts talking in an open-plan office without being
asked is a first impression people fix by closing the tab.

**Replies go through `speakableText` first** (`lib/speech-text.ts`,
tested). Claude writes to be read: bullets, bold, backticked column
names, the odd URL. Read literally, all of that is the difference between
a finished-sounding feature and a screen reader having a bad day. Action
receipts are not spoken — the Undo button is on screen, and reading undo
affordances aloud is noise.

**Two platform quirks, both handled, both easy to re-break.**
`speechSynthesis` lives on `window`, not in React, and will happily keep
talking after the component unmounts — hence the cancel in the effect
cleanup, and the cancel before each new utterance so two answers don't
queue up back to back. And iOS won't play synthesised speech at all until
something has been spoken inside a user gesture, so tapping the mic or
the voice toggle fires a silent utterance to unlock it.

**The known ceiling is voice quality.** Browser voices are good on macOS
and rough elsewhere, and there's no fixing that for free. `speak(text)`
is deliberately its own small surface so swapping in a hosted voice later
is one file rather than a rewrite.

## 9. The activity page

`/dashboard/activity` — everything Nexus has changed on the account,
newest first, grouped by day, with Undo on anything reversible.

The action log and `POST /api/actions/[id]/undo` were both built long
before this page. Without it the log was a table nobody could look at and
the undo needed an id and a curl, which meant the trust the log was
written to buy was sitting in Supabase where no user could see it.

It matters more since chat gained tools. Actions used to come from
buttons, so a user always knew what had happened; now one sentence can
change three things and a conversation scrolls away.

**Design notes worth keeping.**

- **`target` is not sent to the browser.** It holds Gmail message and
  draft ids, filter ids, CalDAV object URLs and a full event snapshot —
  everything needed to act on a mailbox. The page needs to name what
  happened and offer the undo, and nothing more. Note this doesn't make
  the page insensitive: `summary` legitimately contains recipient
  addresses, subject lines and event titles, because a log that says
  "archived 4 messages" without saying which is not an audit trail.
- **Undo is claimed before it runs.** The read and the reversal aren't
  atomic, so two clicks on a slow undo both saw it un-undone and both
  reversed it — and `restore_event` run twice means two calendar events
  and a second invitation to every guest. A conditional update on
  `undone_at is null` is the lock; any non-success hands the claim back
  so a real failure stays retryable.
- **A restored event says it's a new one.** The undo route has always
  flagged `recreated`; the page now shows it, because presenting it as a
  clean reversal would claim the guests' copies and any prep checklist
  came back, and they didn't.
- **A 422 removes the button.** That status means the action was never
  structurally reversible — nothing recorded to act on, or a kind the
  undo route doesn't handle. Clicking again can't help, so the row says
  so instead of inviting a retry that fails forever.

## 10. The memory layer

Nexus takes notes. While the brief is being written, the same model call
records any durable fact today's mail or calendar revealed — who a person
is to the user, a deadline they're working toward, a project in flight,
how they like to work — and those notes are read back into every later
brief and chat answer. `lib/memory.ts`, table `user_facts`.

This is Layer 2 from ROADMAP.md — inferred, not told — and it is the
first thing in the app that writes something about the user the user
never said. Everything below follows from that.

**Extraction is free.** `facts` is a field on the existing `write_brief`
tool, not a second model call. The roadmap's cost warning is explicit
about model calls scaling with usage, and the brief already has the whole
day in context — a separate extraction pass would pay twice to read the
same mail. It also means extraction happens about once a day per user,
which is the right cadence: the brief is cached, so a refresh doesn't
re-learn.

**The field is required with a zero floor.** The news section learned
this the expensive way — a low-effort model hands back an optional array
roughly never. `minItems: 0` with the field required makes the model
decide rather than skip, and the prompt says plainly that zero is the
normal answer.

**Every fact cites a source, and the citation is checked.**
`sanitizeExtractedFacts` drops any fact whose `sourceId` isn't one of the
message ids or event keys actually handed to the model on that run. Same
enforcement, same reasoning as `resolveNewsHighlights`: a model told to
cite can still not cite, and one that invented the citation invented the
fact. A category outside the enum is dropped rather than defaulted, for
the same reason.

**Facts expire, and deadlines expire whether or not the model said so.**
An undated deadline gets 30 days; nothing at all is kept past a year
without being re-observed; an expiry already in the past is treated as
missing. A stale fact is worse than a missing one, because in a prompt it
reads as confident.

**Retrieval is keyword overlap, and preferences get a floor.**
`selectFacts` scores a fact by how many of its words appear in what the
call is about — today's subjects and senders for the brief, the question
itself for chat. Preferences ("no meetings before 10") get +1 without
needing a match, because they're relevant to questions that share none of
their vocabulary. Vector search is a later optimization; at a few dozen
facts per user it would be machinery bought for a problem nobody has.

**Chat reads memory but never writes it.** A chat turn sees a slice of
the mailbox and would learn the same fact from three different angles in
one conversation. One writer, and it's the one that sees the whole day.

**Reading memory can fail without breaking anything.** Same rule as the
profile: an unreadable memory is an empty one, and a user whose facts
don't load gets exactly the brief they got before this existed.

**`/dashboard/memory` is the price of admission.** Everything inferred is
listed with what it was read out of, when it was learned, and when it
will be forgotten — and Forget really deletes the row. Inferring things
about someone off-screen is how a useful feature becomes a creepy one;
the roadmap says surface the inference, and this page is that.
