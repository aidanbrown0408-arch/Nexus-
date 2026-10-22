# Google OAuth verification — prepared answers

Nexus requests two **restricted** Gmail scopes, so Google requires (1) brand
and scope verification and (2) an annual third-party security assessment
(CASA) before the app can leave "Testing" (capped at 100 users, with an
"unverified app" screen). Submit from Google Cloud Console → Google Auth
Platform → Data Access / Verification Center.

## Before submitting

- [ ] A domain you own, verified in Google Search Console, serving the app
      over HTTPS. Homepage, `/privacy` and `/terms` must be on that domain.
- [ ] `lib/site.ts` filled in with your real legal entity and contact emails.
- [ ] OAuth consent screen: app name "Nexus", logo, support email, the
      homepage / privacy / terms URLs, authorized domain.
- [ ] Production Clerk instance on that domain (the preview currently shows
      Clerk's "Development mode").
- [ ] A demo video (unlisted YouTube) — see the script below.

## Scopes requested

Two restricted Gmail scopes (`gmail.modify`, `gmail.settings.basic`) and
four sensitive ones (`calendar.readonly`, `calendar.events`,
`contacts.readonly`, `contacts.other.readonly`). The app asked for
`gmail.readonly` and `gmail.compose` too until October 2026; both are
covered by `gmail.modify` and were dropped to shorten the review.

## Scope justifications (paste per scope)

**gmail.modify** — Nexus reads the user's recent inbox to write a morning
brief, to answer questions the user asks about their mail in chat, to show
a message in the in-app reading pane, and to find email related to an
upcoming meeting. When the user clicks "Draft reply" or asks for a reply in
chat, it writes the reply into their Gmail Drafts folder for them to review
and send themselves — Nexus has no send function. On the user's request (a
button, or a chat instruction they confirm) it archives messages, applies
labels, or moves messages to Trash; every change is logged on the user's
Activity page with an Undo, and nothing is permanently deleted. Message
content is sent to our AI provider only to produce the response the user
asked for, and is not stored beyond the day's brief summary.

**gmail.settings.basic** — Users can describe a filter in plain English
("archive newsletters from Substack"); Nexus shows the parsed rule for review
and, when the user confirms, creates the Gmail filter. Users can list and
delete filters Nexus created.

**calendar.readonly** — Nexus lists the user's calendars and upcoming events
to build the daily brief, answer schedule questions, find free time, and
attach preparation checklists to meetings.

**calendar.events** — At the user's request Nexus creates, reschedules or
cancels events. Changes that would notify other guests are only made from the
event form where the user reviews the guest list, and every change is
undoable from the Activity page.

**contacts.readonly** and **contacts.other.readonly** — Used to suggest
people when the user adds guests to an event and to recognize the people the
user marked as important (VIPs) so their mail is never proposed for archiving.

## Demo video script (≈3 minutes)

Google wants to see the OAuth flow and each scope in use, with the URL bar
visible and the OAuth client ID shown on the consent screen.

1. Open the homepage on the production domain; click Connect your Gmail;
   sign in.
2. Show the Google consent screen (expand "App info" to show the client ID).
3. Morning brief → shows mail and calendar being read (readonly scopes).
4. Open an email → Draft reply → open Gmail Drafts to show the draft
   (modify).
5. Tidy up → archive two newsletters → show them archived in Gmail → Undo
   (modify).
6. Filters → "archive newsletters from Substack" → confirm → show the filter
   in Gmail settings (settings.basic).
7. Calendar → add an event with a guest picked from contacts → move it →
   cancel it (calendar.events, contacts).
8. Settings → Disconnect Google, then Delete account.

## Security assessment (CASA)

After scope approval Google emails instructions to complete a CASA Tier 2
assessment with an approved lab; it is paid and renewed yearly. Things the
assessors look for that are already in place: TLS everywhere, OAuth tokens
encrypted at rest (AES-256-GCM), least-privilege database access (RLS on, no
client-side database key), per-user rate limits, account deletion, and no
long-term storage of message content.
