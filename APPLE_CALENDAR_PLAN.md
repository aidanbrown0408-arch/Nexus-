# Connecting Apple Calendar — the plan in plain English

## Why this isn't "just add another Connect button"

Google Calendar worked the way it did because Google supports OAuth:
you click Connect, Google shows you a permission screen, you approve,
and Google hands your app a token behind the scenes. You never touch a
password.

Apple doesn't offer that for iCloud Calendar. There's no "Sign in with
Apple" for calendar data. Instead, Apple exposes calendars through an
older, different protocol called **CalDAV**, and the only way an app
like Nexus can authenticate is with something called an
**app-specific password** — a second, single-purpose password the user
generates themselves on Apple's website and pastes into your app. It's
not a security downgrade, it's just Apple's model: no OAuth consent
screen exists to build against.

Practically, this means: no "Connect with Apple" button that redirects
anywhere. Instead, a small form where the user enters their Apple ID
email and a password they generated specifically for Nexus.

## What the user has to do first (before your app can do anything)

This part happens on Apple's site, not in your app, and every user
who wants to connect will have to do it themselves:

1. Sign in at appleid.apple.com.
2. Go to Sign-In and Security → App-Specific Passwords.
3. Generate one, name it something like "Nexus".
4. Copy the password it shows (looks like `abcd-efgh-ijkl-mnop`) —
   Apple only shows it once.

Your app then asks the user to paste their Apple ID email and that
generated password into a form. That's the entire "connect" flow from
the user's side — a form, not a redirect.

## What your app does with it

1. **Takes the email + app password from the form.**
2. **Talks to Apple's CalDAV server** (`caldav.icloud.com`) using
   those credentials to ask "which calendars does this person have,
   and what events are on them." This is a different kind of request
   than the Google Calendar API — CalDAV speaks in a older format
   called iCalendar (the same `.ics` format calendar invites use), not
   the clean JSON Google returns. There's a library (`tsdav`) that
   handles the CalDAV back-and-forth, but the events still come back
   needing to be converted from that older format into the same shape
   your Google events already use, so the rest of the app — the
   Calendar box, the Morning Brief — doesn't need to know or care which
   calendar an event came from.
3. **Stores the credentials**, the same way you store the Google
   token today — in Supabase, encrypted, tied to the signed-in user.
   App-specific passwords don't expire the way OAuth tokens do, so
   there's no refresh logic needed here, which is actually simpler
   than the Google side.

## Where this plugs into what you already have

The good news: the *shape* of the work is familiar, because you just
built it once for Google.

- A new table in Supabase, `apple_credentials`, next to
  `google_tokens` — same RLS pattern (enabled, server-only access).
- A new connect flow — but a form instead of a redirect, so no
  `/api/apple/connect` or `/api/apple/callback` routes are needed,
  just one route that accepts the form and stores the credentials.
- A `fetchAppleEvents` function, written the same way
  `fetchUpcomingEvents` was — same job, different source, same output
  shape (`EventSummary[]`) so nothing downstream changes.
- The Calendar box and Morning Brief then just **merge** Google events
  and Apple events into one sorted list before rendering. Neither of
  them needs to know two sources exist — this is exactly the
  "cross-tool intelligence" idea from your business plan showing up in
  the actual architecture: one clean event list, however many calendars
  feed it.

## The honest tradeoffs

**It's more support burden than Google.** A user who mistypes their
app-specific password, or later revokes it on Apple's site without
telling you, will start seeing "Apple Calendar disconnected" with no
graceful re-auth flow the way Google's `prompt: consent` gives you —
they'll need to generate a new password and re-enter it.

**It's real, ongoing value for the product.** A meaningful share of
your target users run iPhones with iCloud Calendar as their only
calendar, or split between iCloud and Google. If the Morning Brief only
reads Google Calendar, it's silently wrong for anyone in that group —
missing meetings, not because the model failed, but because half their
calendar was never fetched. That's a bad first impression for a
product whose whole pitch is "actually knows your life."

**It's a good V2 candidate, not urgent this week.** Your own MVP list
(Gmail + Google Calendar + Brief + Chat + Dashboard) doesn't include
it — it shows up as a V3/V4 item. Chat is still the thing that makes
the app feel like more than two data feeds, and it's mostly built
already given the Brief's plumbing. Apple Calendar adds real breadth
but no new *kind* of intelligence.

## Suggested order, if and when you build it

1. Supabase table + a form-based connect route (no CalDAV calls yet —
   just accept and store credentials, confirm they save correctly).
2. `fetchAppleEvents`, tested against your own iCloud account, returning
   the same `EventSummary[]` shape as the Google fetcher — verify by
   logging it, not by wiring it into the UI yet.
3. Merge Apple events into the existing Calendar box and Brief — at
   this point it should look like nothing changed except more events
   showing up.
4. Handle the failure case: bad or revoked password shows a
   reconnect-style prompt, same spirit as the Google scope_missing flow.

## What to do next

Nothing urgent. If you want it now, I can turn step 1 above into a
prompt like the ones we used for the Brief. If you'd rather keep
momentum on Chat — which is most of the way built already thanks to
the Brief's plumbing — say the word and I'll write that plan instead.
