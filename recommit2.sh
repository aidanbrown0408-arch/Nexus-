#!/usr/bin/env bash
# Commit the brief cache and the scheduled brief.
#
# Run from the repo root in your own Terminal — the Claude bridge can't
# delete git's lock files, which is what broke the first attempt:
#     cd ~/Nexus- && bash recommit2.sh
set -euo pipefail

T="Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013Wqf9hZUbQeDrxs6gNRKA4"

c () { git commit -q -m "$1" -m "$2" -m "$T"; echo "  committed: $1"; }

git add lib/brief.ts app/api/brief/route.ts
c "Make the brief generatable without a request" \
"The pipeline moves out of the route and behind generateBrief(userId), returning a result rather than an HTTP response — a route turns a failure into a status code, a scheduled job turns it into \"skip this user and carry on\". The route drops to sixty lines."

git add lib/brief-cache.ts lib/supabase.ts app/dashboard/BriefSection.tsx
c "Write today's brief once, read it many times" \
"A model call over the whole inbox, twelve to twenty seconds, was being paid for on every page load and twice per load in development. Now stored per user per day and regenerated only when asked. A degraded brief is never stored — cached, a 7am calendar blip would report an unavailable calendar for seventeen hours."

git add lib/clock.ts lib/profile.ts lib/triage.ts
c "Match VIPs by whole tokens, not substrings" \
"Two failures in opposite directions: whole-string matching missed every phrase entry, so \"my co-founder Marcus\" — the format onboarding suggests — protected nobody; substring matching on the raw address protected far too much, with \"Ann\" covering announcements@ and \"Sam\" covering all of samsung.com. Addresses now match exactly and names match as whole tokens."

git add lib/mailer.ts lib/brief-email.ts lib/deliveries.ts app/api/cron vercel.json
c "Send the brief instead of waiting to be visited" \
"An hourly job delivers each user their brief in the hour matching the morning_time the interview has been collecting since the beginning and nothing used. Every guard fails toward silence: finished interviews only, their timezone, once a day, not at weekends if they said so, and never during an outage. An ambiguous send keeps its duplicate guard rather than clearing it — one missed brief beats two identical ones."

git add app/api/chat/route.ts lib/calendar-sources.ts lib/calendar.ts lib/apple.ts app/dashboard/CalendarSection.tsx lib/onboarding-questions.ts
c "Stop the calendar quietly under-reporting itself" \
"Each source clips its own fetch before the merge sees it, so a busy calendar returned exactly its cap and the card called it complete. Truncation is now detected at both cuts and disclosed to chat, which had been told to answer from that list alone. Switching ranges no longer lets a slower wider request paint over a narrower one."

git add lib/schedule.ts tests tsconfig.test.json package.json .gitignore lib/rss.ts
c "Add tests, without adding a test framework" \
"Node 22 ships a test runner and TypeScript was already here, so this costs one config file and no new supply chain. Every case is a bug that actually happened: VIP matching failing in both directions, a second brief an hour after the first across midnight, nine ways a real feed broke the parser. The scheduling decision moves into lib/ so it can be tested without an HTTP request — which is the general rule this sets up."

git add lib/chat-tools.ts app/api/chat/route.ts app/dashboard/ChatSection.tsx lib/actions.ts "app/api/actions/[id]/undo/route.ts" app/api/gmail/archive/route.ts app/api/gmail/draft/route.ts tests/action-targets.test.cjs
c "Let the chat box act, reversibly" \
"A dozen working action routes sat beside a chat box that could only describe them. It can now draft, archive and label — the reversible half only, since a conversation is not the preview that irreversible actions require. Each id is checked against what the model was actually shown, each action is logged with its undo, and the receipt appears under the sentence that claimed it. Writers and the undo route now share one set of target builders: chat wrote \`ids\` where undo read \`messageIds\`, so every undo it offered failed silently."

git add app/api/actions/route.ts app/dashboard/activity app/dashboard/page.tsx lib/actions.ts "app/api/actions/[id]/undo/route.ts"
c "Show what Nexus has done, and let it be put back" \
"The action log has recorded every change since it was built and the undo route has always been able to reverse one, but there was no page — the trust the log was written to buy sat in a table nobody could look at. It matters more now that a sentence in chat can change three things. Undo is claimed before it runs, because two clicks on a slow one both reversed it, and a restored event is labelled as the new event it actually is."

git add lib/events.ts lib/availability.ts lib/filters.ts lib/calendar-write.ts lib/clock.ts app/api/calendar/availability/route.ts app/api/gmail/filters/route.ts app/dashboard/FindTime.tsx app/dashboard/FiltersSection.tsx
c "Fix six ways the calendar and filters were quietly wrong" \
"Recurring events deduped on UID alone, so a weekly standup appeared once and every later occurrence was dropped — the brief would call a day clear that had a standup on it. Working hours were read on the host, which is UTC, so \"find 30 minutes\" offered a Los Angeles user 2am. A multi-day all-day event blocked only its first day. A filter could be built from has:attachment alone, permanently trashing every future contract and invoice. Restoring a deleted series failed outright without a timezone, and re-invited guests who were never told it was cancelled. The sweep moved 200 and let the user believe it had cleared 1,400."

git add SETUP.md .env.local.example
c "Document the cache, the scheduler, and their sharp edges" \
"Two new tables, theenvironment they need, and the things that will bite: Vercel Hobby only runs cron daily, a missing markets key is config rather than an outage, and the whole-day cache means new mail waits for a Rewrite."

echo
echo "Done. Review with:  git log --oneline -8"
echo "Nothing has been pushed."
