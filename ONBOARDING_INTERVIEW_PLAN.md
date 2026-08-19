# Onboarding Interview — the plan in plain English

## The problem this solves

Right now every Nexus user gets the same brief, the same draft voice,
the same "here's what's urgent" logic. The app has no idea if you're a
solo founder drowning in investor email, an engineer who only cares
about incidents, or someone whose calendar is the real chaos and mail
is fine. ROADMAP.md already calls this out as Stage 2, Layer 1 — "what
you told it" — and proposes a settings page for it.

This plan is that same idea, done as a five-minute conversation instead
of a form. A blank settings page with four empty text boxes doesn't get
filled in — people skip it and go straight to the dashboard. A short,
specific interview at first sign-in gets answered, because it's one
question at a time and it's in front of them before they've decided the
app is "done" being set up.

## What the interview actually asks

Two tiers. Eight **core** questions everyone gets, because completion
rate drops with every screen and these eight alone already make the
brief noticeably sharper. Then three **optional sections** — offered
after the core eight, each skippable as a whole group rather than
question by question, so someone can say "skip the business context
stuff" without abandoning the interview entirely.

### Core (everyone sees these)

1. **What do you do, in one line?** ("Founder, 12-person startup" /
   "Eng manager" / "Runs ops for a small agency.") This alone tells
   Nexus what "urgent" probably means for this person.
2. **What sector do you work in?** Preset choices — law, medicine,
   finance/accounting, tech, real estate, education, consulting,
   "other" with free text — rather than folding this into question 1.
   Sector drives urgency vocabulary in a way role alone doesn't: a
   lawyer's "urgent" means a filing deadline, a doctor's means a
   patient or on-call page, a finance person's means a close date or a
   market-hours window. The brief prompt can lean on sector-specific
   framing ("this looks like a court deadline") instead of generic
   phrasing.
3. **Who are three people whose email you never want buried?** Names or
   just relationships — co-founder, spouse, your manager. This seeds
   the VIP list directly.
4. **What's the one thing on your plate this week that you'd hate to
   drop?** A sentence, fed straight into the brief's system prompt as
   current context. This is the single highest-leverage answer in the
   whole interview.
5. **What should Nexus stop showing you?** Newsletters, receipts,
   recruiter spam, internal Slack-to-email digests — whatever's noise
   for this person specifically.
6. **When do mornings start for you?** Feeds the brief-ready time and
   the timezone, which the brief needs correctly or "today" means
   nothing (this bit you before, in the timezone note on the brief
   plan).
7. **Want any news in your brief — financial markets, industry news,
   general headlines?** Checkboxes, not free text: Financial/markets,
   Industry news (tailored to their sector from question 2), General
   headlines, or none of the above (the default, and the most common
   answer — most people don't want a news digest bolted onto their
   inbox summary). This is the one core question that can add a whole
   new *section* to the brief rather than just reshaping the existing
   one, so it's worth asking explicitly instead of leaving it to the
   catch-all — a checkbox gets answered, an open "anything else?"
   rarely surfaces "also give me stock news" on its own.
8. **Anything else you'd want in your morning brief that we haven't
   asked about?** One open catch-all field, placed last on purpose —
   by question 8 someone has a concrete sense of what the brief is for
   and can name something specific ("flag anything from my landlord,"
   "tell me if a court date changes," "include weather if I have an
   outdoor meeting") that no preset question would have surfaced. Free
   text, genuinely optional-feeling even though it's in the core flow —
   an empty answer here is a fine, common outcome.

At the end of question 8, one screen: "Want to tell Nexus a bit more?
Takes another two minutes." Three buttons, one per section below, plus
"I'm done." Answering none of them is a completely normal outcome, not
a failure state — the core eight already deliver most of the value.

### Optional — communication style

Feeds draft tone once the gmail-draft feature ships, and the brief's
own voice in the meantime.

9. **When Nexus drafts something for you, should it lean short and
   direct, or warmer and more detailed?** Two or three preset choices,
   not free text — this is a dial, not an essay question.
10. **How do you want to hear about something urgent?** Options like
    "just the facts" vs. "give me a little context first." Feeds how
    the brief's headline and greeting are phrased, not just what's in
    it.

### Optional — company context

Useful once Nexus starts reasoning about business priorities, not just
inbox triage — e.g. knowing a fundraise is live changes what counts as
urgent far more than knowing someone's job title does. This sits
alongside sector (question 2, which is about the *field*) rather than
replacing it — a solo-practice lawyer and a 200-person firm both say
"law" for sector but need very different urgency framing.

11. **What does your company do, in one line?** Separate from role
    (question 1 is about *them*, this is about the business).
12. **What stage is it at?** Preset choices — pre-seed / bootstrapped
    and revenue-generating / funded and scaling / established company
    — rather than free text, since this is really a small enum.
13. **Roughly how big is the team?** A range, not an exact number.

### Optional — work rhythms & boundaries

Feeds scheduling logic (Stage 1's "find and hold a time") and the
proactive-notification restraint Stage 3 already calls for.

14. **Any hours you don't want interrupted?** A simple time range —
    "no notifications before 9am" or "1-3pm is deep work." This is the
    seed of the "back off after being ignored" behavior the roadmap
    wants for Stage 3, made explicit instead of inferred.
15. **Should Nexus reach you on weekends, or hold everything for
    Monday?** A yes/no with an escape hatch for "only if it's
    actually urgent."

Fifteen total, eight required. That split matters more than the exact
count — a required block that stays short protects completion, and an
optional block gives people who *want* to be known well a place to say
more, without punishing people who just want the brief to work.

## How it works, conceptually

Three steps:

1. **Trigger.** First time a signed-in user hits `/dashboard` and has
   no row in a new `user_profile` table, redirect to `/onboarding`
   instead of showing the dashboard. Skippable — a "set this up later"
   link that goes straight to the dashboard with defaults, because
   forcing it is how you lose someone at question two.
2. **Collect.** One question per screen, plain text input, a progress
   dot (1 of 8) through the core section. No branching logic needed
   yet — that's a later refinement, not a v1 requirement. After
   question 8, the three-button offer screen; anyone who takes an
   optional section gets the same one-per-screen treatment for those
   questions, with its own short progress indicator so it's clear
   they're in a bonus round, not the main interview running long.
3. **Store and use.** Answers land in Supabase as a few short text
   fields. The brief route (`app/api/brief/route.ts`) already builds a
   `SYSTEM_PROMPT` and calls Claude — this just means reading the
   profile row first and appending it to that prompt: "This user is a
   founder at a 12-person startup, in tech. Their VIPs are X, Y, Z.
   This week they're focused on: raising the seed round. Don't
   surface: LinkedIn notifications, receipts. Include a short
   financial markets note, since they asked for it — nothing else in
   the news categories. They also asked to be told if a court date
   changes. Keep replies short and direct. Company is pre-seed, 12
   people. No notifications before 9am." The news answer (question 7)
   is the one that changes the brief's *shape*, not just its
   framing — if financial or industry news is selected, the brief
   route needs a second, smaller data pull (a markets summary, a
   sector headline) and a new section in the `write_brief` tool
   schema to hold it, rather than just more text in the system
   prompt. Same personalization pattern applies to the gmail draft
   route once that ships, for tone and VIP-aware urgency — questions
   9 and 10 exist specifically for that route.

## Data model

One table, `user_profile`, one row per Clerk user id. Core fields first,
optional-section fields nullable and clearly grouped so it's obvious
which came from the required flow versus the bonus round:

Core:
- `role_description` (text) — question 1
- `sector` (text, enum-like: `law` / `medicine` / `finance` / `tech` /
  `real_estate` / `education` / `consulting` / `other`, with a free
  text companion field when `other`) — question 2
- `vips` (text[]) — question 3, stored as a simple array, not a
  separate relational table yet
- `current_focus` (text) — question 4, the one that goes stale fastest
- `noise_filters` (text[]) — question 5
- `morning_time` (time) + `timezone` (text) — question 6
- `news_preferences` (text[], values from `financial` / `industry` /
  `general`, empty array meaning none — not null, since "no news" is a
  real, explicit choice rather than an unanswered one) — question 7
- `brief_wishlist` (text, nullable) — question 8, the open catch-all;
  nullable because leaving it blank is a normal, expected answer
- `completed_at` (timestamp, nullable) — null means "skipped," so you
  can tell completed-but-generic apart from never-asked

Optional — communication style:
- `draft_tone` (text, enum-like: `short` / `warm`) — question 9
- `urgency_style` (text, enum-like: `direct` / `contextual`) — question 10

Optional — company context:
- `company_description` (text) — question 11
- `company_stage` (text, enum-like) — question 12
- `team_size_range` (text, enum-like) — question 13

Optional — work rhythms:
- `quiet_hours` (text, e.g. `"09:00-13:00"` or free text for v1) —
  question 14
- `weekend_contact` (text, enum-like: `never` / `urgent_only` / `yes`)
  — question 15

Keep it flat. This is Layer 1 from the roadmap — explicitly told, not
inferred — so there's no need for the fact-table-with-sources structure
that Layer 2's inferred preferences will eventually want. The three
optional groups are just more flat columns, not separate tables — a
user who skips them just leaves those columns null, and the brief
prompt only mentions what's actually filled in.

## The order to build it in

**1. The table and the skip path first.** Add `user_profile`, wire the
dashboard redirect, and make "skip" work before any question exists.
Confirm a user with no row gets redirected, a user who skips lands on
the dashboard normally, and a user who never triggers it (existing
users) isn't suddenly locked out.

**2. One hardcoded question screen.** Get the one-question-per-screen
UI working with fake data first, same reasoning as the brief plan — you
want to know the *screens* work before wiring them to anything real.

**3. The eight core questions, writing to Supabase.** Extend the single
screen into the eight-question flow, each answer saved as it's given
(not all at the end) so a user who closes the tab halfway through
doesn't lose what they already answered.

**4. The optional sections.** Add the "want to tell Nexus more?" offer
screen and the three question groups behind it. Build this after the
core flow is solid — it's additive, and shipping the core eight alone
is already a complete, useful version of this feature.

**5. Feed it into the brief prompt.** Read `user_profile` in the brief
route, append it to `SYSTEM_PROMPT`. This is the step where the feature
actually starts paying for itself — you should be able to answer the
interview yourself and immediately see your next brief change.

**6. A way to re-answer it.** People's focus changes weekly; a
settings page that reopens all questions — core and any optional ones
they answered — pre-filled, is enough. No need for a fancier profile
editor yet.

## Things that will go wrong (and are fine)

**Low completion rate at first.** Expect some users to skip. That's
fine — it's a signal to shorten or reorder questions, not a reason to
force completion.

**"Current focus" goes stale.** A week-old answer describing last
week's priority is actively wrong, not just unhelpful. Worth a soft
nudge — "still working on X?" — once you're past v1, but don't build
that yet.

**VIPs as free text will be messy.** People will type "my wife" instead
of a name or email. Fine for v1 — the brief prompt can use it as
context even if it's not machine-matchable to an email address yet.
Matching against actual Gmail contacts is a real improvement, but it's
Layer 2 territory (inferred from behavior), not this.

**Almost nobody finishes the optional sections, and that's fine.** If
completion on the bonus round is low, that's not a sign to force it —
it's confirmation the core eight were the right things to make
required. Watch which of the three optional sections gets skipped
least; that tells you which one to consider folding into the core set
later, rather than guessing.

**Sector presets won't cover everyone.** Someone in nonprofit, trades,
or government will hit "other" immediately. That's fine — "other" plus
free text still gives the brief prompt something to work with, and if
a particular "other" answer shows up constantly, it's a cheap signal
to add a new preset later.

**Most people will pick "none" for news, and that's the point.** A
brief that stays email-and-calendar by default and only grows a news
section for people who explicitly asked is safer than guessing. Don't
read low uptake as the question failing — it's the question doing
exactly what it's for, which is keeping news out of the 80% of briefs
that don't want it.

## Why this before Layer 2 or Layer 3

The roadmap is right that inferred preferences (Layer 2) and voice
matching (Layer 3) are the deeper moat. But both need something to
compare against and both take weeks of usage to accumulate signal. The
interview gets you a personalized brief on day one, for one screen of
work, and it's also what makes Layer 2 legible later — "Nexus noticed
you always reply to Sarah fast" means more to a user who already told
you Sarah's a VIP than to one who's never been asked.

## What to do next

Add the `user_profile` table and the skip-aware redirect first — step 1
above — and confirm existing users aren't affected before writing a
single question screen.
