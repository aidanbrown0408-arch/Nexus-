# Morning Brief — the plan in plain English

## What you have right now

Your dashboard has two boxes. One lists your recent emails. One lists
your upcoming calendar events. They sit next to each other and neither
knows the other exists. That's a viewer — useful, but Gmail already
does it.

## What the Morning Brief is

One box at the top of the dashboard that reads both lists and tells you
what actually matters today. Something like:

> **Three things need you this morning.**
> Sarah's waiting on the Q3 budget before your 2pm — she asked
> yesterday and the meeting is on your calendar.
>
> - Reply to Sarah re: Q3 budget (before 2pm)
> - Confirm the Thursday vendor call — you haven't responded
> - Your afternoon is fully booked; anything new goes to tomorrow
>
> *Four meetings today, back-to-back from 1pm.*

Notice what makes that different from your two boxes: it connected an
email to a meeting. Neither list could have told you that on its own.
That connection is the whole product. It's the thing in your business
plan that Gmail and Copilot don't do, and this is the smallest version
of it you can actually build.

## How it works, conceptually

Four steps happen when you load the dashboard:

1. **Gather.** The app pulls your unread emails and today's events —
   the same two pulls it already does for the existing boxes.
2. **Narrow.** It throws most of it away. Only unread mail, only today
   and tomorrow's events. Sending Claude everything makes the answer
   vaguer, not better — same as briefing a person: give them the
   relevant stuff, not the whole inbox.
3. **Think.** It hands that bundle to Claude with instructions: find
   what needs a decision today, point out connections between the email
   and the calendar, be specific, and don't invent urgency that isn't
   there.
4. **Show.** Claude's answer renders in the new box at the top.

Steps 1 and 4 you've already built versions of. Steps 2 and 3 are new,
and step 3 is where the actual thinking happens.

## What you need before starting

An Anthropic API key from console.anthropic.com. It goes in your
`.env.local` file alongside your Google and Supabase keys — the same
file you've already been filling in. It's a paid key: each brief costs
a fraction of a cent. For you testing alone, pennies a month.

## The order to build it in

This ordering isn't fussiness — each step exists to keep you from
debugging two unknowns at once.

**1. Tidy up first.** The code that fetches your email and your
calendar currently lives inside the two dashboard boxes. The brief
needs that same data, so it has to move somewhere both can reach it.
Nothing about the app changes visibly — the dashboard should look
identical when you're done. That's the point: if it looks different,
something broke, and you'll know before layering anything new on top.

**2. Fake the brief.** Build the new box and have it display a
hardcoded, made-up brief. No Claude involved yet. This is the step
people skip and regret. When the real thing eventually looks wrong,
you'll want to know instantly whether the *display* is broken or the
*thinking* is — and you can only know that if you tested the display
by itself first.

**3. Make it real.** Swap the fake brief for a real Claude call. Now
when something's off, it's the instructions to Claude, because you
already proved the box works.

**4. Tune the instructions.** This is the part that takes longest and
it isn't really programming — it's editing. You read the brief, decide
it's too vague or too dramatic or missed something obvious, and adjust
what you tell Claude. Expect several rounds. This is where Nexus
actually gets good, and it's work you're well suited to, because you
know what a useful brief looks like.

**5. Remember it.** Save each day's brief so reopening the dashboard
doesn't regenerate it. Instant loads, lower cost. Only worth doing once
the brief is good enough to be worth keeping.

## Things that will go wrong (and are fine)

**Calendar might fail for someone.** Anyone who connected Google before
you added Calendar has a permission that predates it. You already
handle this — the reconnect prompt. The brief should do the same thing:
if the calendar isn't available, write the brief from email alone and
say so, rather than showing nothing.

**Claude might return something unusable.** Rare, but it happens. When
it does, that box shows a "couldn't generate, retry" message and your
email and calendar boxes keep working normally. One failure shouldn't
take the page down.

**Timezones.** "Today" means nothing to Claude unless you tell it where
you are and what time it is. Miss this and an evening refresh will
cheerfully show you tomorrow's meetings as today's. Easy to fix, easy
to forget.

## Why this feature, before Chat

Chat sounds more impressive and is the natural thing to want next. But
chat only answers when asked — the brief shows up on its own, which is
the "proactive, not reactive" claim your plan leans on. And practically:
chat reuses almost everything the brief builds. Same connection to
Claude, same data gathering, same pattern of assembling context and
asking a question. Build the brief and chat becomes mostly assembly
work rather than a fresh start.

## The open question worth deciding early

A brief you have to open isn't really a *morning* brief. The version in
your business plan arrives — email at 7am, or a notification. That
needs a scheduler and permission to send mail as you, so it's more
work, and it's not worth doing until the brief itself reads well enough
that you'd want it in your inbox. But it's the difference between a
dashboard feature and a product, so keep it in view.

## What to do next

Get the Anthropic API key, then work through steps 1-3 above. If you're
building with AI assistance, hand it this file and ask for one step at
a time — checking that the app still runs between each. Bundling all
five steps into one request is how you end up with something broken and
no idea which part did it.
