# Nexus — where this goes next

## The honest state of things

Right now Nexus reads. It pulls your mail, pulls your calendar, and
hands both to Claude to write a brief. The brief is genuinely good —
it connects an email to a meeting, which neither list could do alone.

But it's still a thing you look at. You read the brief, then you go
open Gmail and do the work yourself. Every read-only assistant hits
this same ceiling: it tells you what to do, and then you do it.

Nobody pays monthly for a nicer summary. People pay for something that
*takes work off their plate* and *knows them well enough to be trusted
with it*. That's two separate problems, and this document is about
solving them in the right order.

## The arc, in four stages

Each stage is worth building on its own. Each one makes the next one
possible. Don't skip ahead — stage 3 is worthless without stage 2,
because an assistant that knows you but can't act is just a very
well-informed observer.

1. **It can act.** Draft, archive, schedule, decline. You approve.
2. **It remembers.** It knows who matters to you and how you write.
3. **It notices.** It runs without being asked and tells you things.
4. **It's worth money.** Which is a consequence of 1–3, not a feature.

---

# Stage 1 — From reading to doing

## What changes conceptually

Every action goes through the same three-beat loop:

**Propose → Approve → Execute.**

Nexus never does anything to your account without you saying yes. Not
at first, and maybe not ever for the destructive stuff. This isn't
timidity — it's the only way trust gets built. An assistant that
archives the wrong email once loses you permanently.

The brief already produces structured actions — that's what the
`write_brief` tool schema is doing. The next version produces
*executable* ones. Instead of "Reply to Sarah re: Q3 budget," it
produces that plus a drafted reply sitting behind a button.

## The first three actions to build

Build them in this order. The ordering is about risk: start with the
things that are impossible to regret.

### 1. Draft a reply (zero risk)

Nexus writes a reply and saves it to your Gmail drafts. Nothing is
sent. If the draft is bad, you delete it — the cost of a mistake is
one wasted click.

This is the highest-value, lowest-risk action you can build, and it's
the one people will actually feel. Writing replies is the bulk of the
work an inbox creates.

What it needs: the `gmail.compose` scope added to your OAuth consent,
a new `POST /api/gmail/draft` route, and a prompt that takes the
original thread plus a short instruction ("decline politely," "ask for
the deck," or nothing at all and let it infer).

### 2. Archive and label (reversible risk)

Bulk-clear the newsletters, receipts, and notifications that were never
going to need you. Nexus proposes a list — "these 14 look like noise" —
and you approve as a batch, not one at a time.

Everything here is undoable. Archive isn't delete. Label isn't
destruction. That's why it's second and not tenth.

What it needs: `gmail.modify` scope, a route that takes an array of
message ids and an action, and — critically — an **undo record**: a
row in Supabase logging what was changed so a single "undo that" puts
it all back.

### 3. Find and hold a time (real-world consequence)

"Find 30 minutes with Sarah this week" → Nexus reads both calendars,
proposes three slots, you pick one, it sends the invite.

This one touches other people, which is why it's third. But it's also
the action that feels most like having an assistant.

What it needs: `calendar.events` scope, free/busy logic, and a hard
rule that nothing goes out without an explicit confirm.

## The rule that keeps this safe

Write it down and don't erode it:

> **Reversible actions can be batched. Irreversible actions are always
> individual, always explicit, and always previewed in full.**

Sending an email, deleting a message, and declining an invite are
irreversible. Drafting, archiving, and labeling are not.

## What to build underneath all of it

**An action log.** One Supabase table: what Nexus did, when, on whose
behalf, and what it would take to undo it. Every action route writes to
it. Every user can see it.

This sounds like plumbing but it's actually the product. The reason
people don't trust AI with their inbox is that it's a black box. A
plain, readable list of "here's everything I did for you this week" is
the single strongest trust-building feature you can ship, and it costs
you one table and one page.

---

# Stage 2 — Making it yours

## The problem with the current brief

It writes the same brief for everyone. It doesn't know that mail from
your co-founder always matters and mail from your landlord never does.
It doesn't know you write short. Every morning it starts from zero.

Personalization is what turns "an AI that reads my email" into "*my*
assistant." It's also the thing that makes leaving expensive — a
competitor can copy your features in a month, but they can't copy six
months of your app knowing who this user is.

## Three layers, from easy to hard

### Layer 1 — What you told it

A settings page. Plain fields:

- Who are your VIPs? (mail from these people always surfaces)
- What are you working on right now? (a sentence, fed into the prompt)
- What time is your morning? (when the brief should be ready)
- What do you never want to see? (newsletters, receipts, recruiters)

This is unglamorous and it's most of the value. Just putting a
user-written paragraph of context into the system prompt makes the
brief noticeably sharper.

Storage: one `user_preferences` row in Supabase, injected into the
prompt on every call.

### Layer 2 — What it watched you do

Nexus notices patterns without being told:

- You always reply to this person within the hour → they're important.
- You always archive this sender unread → they're noise.
- You dismissed the same suggestion four times → stop making it.

This is derived from the action log you built in stage 1. That's not a
coincidence — it's why the log comes first.

Important restraint: **surface the inference, don't just act on it.**
"I've noticed you always archive mail from Medium. Want me to do that
automatically?" A yes turns into a rule the user can see and delete.
Silent behavior change based on inferred preference is how products
become creepy.

### Layer 3 — How you sound

Nexus learns your writing voice so drafts don't need rewriting.

The mechanism is simpler than it sounds: pull 20–30 emails you've
actually sent, have Claude write a description of your voice — sentence
length, greeting, sign-off, formality, how you say no — and store that
description. Feed it into every draft prompt.

Then close the loop: when a user edits a draft before sending, that
edit is the highest-quality signal you will ever get. Store the before
and after. Periodically feed a batch of those pairs back to Claude to
refine the voice description.

That feedback loop is the moat. An assistant that gets more like you
every week is one you don't switch away from.

## The memory layer

Underneath all three: a persistent store of facts about the user.
"Sarah Chen is their co-founder." "The Q3 budget is due Oct 15."
"They don't take meetings before 10."

Facts get written by Claude as it processes mail and calendar, and
read back into the prompt on every call. Start dead simple — a table of
short text facts with a category and a timestamp, retrieved by keyword.
Vector search is a later optimization, not a starting requirement.

Rules that keep this from rotting:

- Every fact is visible and deletable by the user.
- Every fact has a source (which email, which event).
- Facts expire. A deadline from four months ago is noise.

---

# Stage 3 — It runs without you

## Why this is the real unlock

Everything so far happens when you open the dashboard. That means Nexus
is a website you visit, and websites you have to remember to visit get
forgotten.

The version people pay for runs whether you're looking or not, and
reaches out when something matters.

## What "running on its own" means

A scheduled job — every morning, and then periodically through the day:

1. Pull what's new since last time.
2. Ask: does anything here need them *now*?
3. If yes, send it. If no, stay silent.

Step 3's "stay silent" is the hard part and the most important part.
An assistant that pings you six times a day gets muted in a week. The
bar for interrupting someone should be genuinely high, and it should
adapt — if the user ignores three notifications in a row, back off.

## Things worth watching for

- **A dropped ball.** You said you'd send something three days ago and
  never did. This is the single most valuable thing an assistant can
  catch, and no email client does it.
- **An unanswered ask.** Someone's waiting on you and it's been a while.
- **A meeting with no prep.** Tomorrow's call has an agenda you haven't
  read.
- **A conflict.** Two things at once, or travel time that doesn't work.

Notice these all require memory of what happened *before* today, which
is why stage 2 comes first.

## Delivery

Email is the right first channel — you already have send capability and
everyone has email. Push notifications and a mobile view come later,
and only if people are actually reading the emails.

---

# Stage 4 — Something people pay for

## What people are actually buying

Not features. Three things:

1. **Time back.** Measurably — "Nexus handled 40 emails this week."
2. **Nothing dropped.** The anxiety of a forgotten commitment, gone.
3. **An assistant that's specifically theirs.** Which is stage 2.

If you can't point to which of those three a feature serves, it's
probably not worth building.

## Shape of the pricing

A rough starting frame, to be tested rather than assumed:

- **Free** — the brief, read-only, one connected account. What you
  have today. This exists to prove the thing works, not to be
  generous forever.
- **Paid, ~$15–25/mo** — actions, memory, voice matching, the
  proactive checks, multiple accounts. The real product.
- **Team, later** — shared context across a small team. Only worth
  touching once individual users are retaining.

The free tier has a real cost: every brief is an API call. Cap it —
one brief a day, a fixed number of manual refreshes. Watch your
per-user cost from the very first paying user; an AI product with
unbounded free usage dies of its own success.

## What has to be true before charging

Don't charge on ambition. Charge when:

- Someone has used it daily for a month without being asked to.
- Drafts get sent more often than they get rewritten from scratch.
- Someone says a version of "how did it know that?"

The last one is the real signal. It means the memory layer is working,
and that's the thing worth paying for.

## The things that will kill this if ignored

- **Trust, once.** One wrongly-sent email loses that user forever. This
  is why approval gates come before autonomy, every time.
- **Privacy, in writing.** You're holding people's mail. A plain-English
  page saying what you store, what you don't, and how to delete
  everything isn't legal boilerplate — it's a sales asset.
- **Cost per user.** Model calls scale with usage. Cache, narrow inputs
  aggressively (you already do this in the brief route), and use the
  cheapest model that's good enough for each job.
- **Doing everything.** Slack, Notion, Drive, CRM — all tempting, all
  dilutive. The thing that makes Nexus good is depth on mail and
  calendar. Add a third integration when the first two are excellent,
  not before.

---

# What to do next, concretely

If you build one thing after this document, build **draft replies**.

It's the shortest path from "interesting" to "useful," it's impossible
to regret, it forces you to build the approve-then-execute pattern
everything else depends on, and it's the first feature where someone
might say "okay, I'd pay for that."

Then the action log. Then preferences. Then voice.
