import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedClientForUser } from "@/lib/google";
import { fetchRecentMessages } from "@/lib/gmail";
import { gatherEvents } from "@/lib/calendar-sources";
import { listPrepItems, type PrepItem } from "@/lib/prep";
import type { EventSummary } from "@/lib/events";
import { getAnthropicClient, CHAT_MODEL } from "@/lib/anthropic";
import { CHAT_TOOLS, runChatTool } from "@/lib/chat-tools";
import type { ActionRecord } from "@/lib/actions";
import type Anthropic from "@anthropic-ai/sdk";
import {
  getProfile,
  profileToPromptContext,
  type UserProfileRow,
} from "@/lib/profile";
import { recallFacts, factsToPromptContext } from "@/lib/memory";
import { nowLines, resolveTimezone } from "@/lib/clock";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chat questions aren't limited to today the way the brief is, so the
// window is wider on both sides.
const MESSAGE_LIMIT = 20;
const SNIPPET_CHARS = 300;
// Wider than the dashboard card's default. A question is just as likely
// to be "when am I next free for a full day?" as "what's on today", and
// unlike the card there's no scrolling cost to carrying more — only
// context, which a month of events doesn't strain.
const CALENDAR_DAYS = 30;
const MAX_HISTORY = 20;

// How many times the model may act before it has to answer.
//
// A cap rather than a trust exercise: each pass is a real change to
// someone's mailbox, and a loop that can't end is one that archives an
// inbox. Three is enough for "draft a reply to Sarah and archive the
// newsletters" and short of anything runaway.
const MAX_TOOL_PASSES = 3;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT =
  "You are Nexus, a personal assistant with access to the user's recent " +
  "email and upcoming calendar events, provided below. Answer their " +
  "questions using only that data. Be specific and concise — name people, " +
  "subjects and times rather than speaking generally. If the answer isn't " +
  "in the data provided, say so plainly instead of guessing. Never invent " +
  "emails, events, or details that aren't there. " +
  "You can also act, using the tools you have: drafting a reply, " +
  "archiving, and labelling. Two rules about that. First, do what was " +
  "asked and nothing adjacent — archiving something they didn't mention " +
  "is worse than asking. Second, when you have acted, say plainly what " +
  "you did in one line; the change is already made and they need to know " +
  "what to check. Everything you can do is reversible and appears in " +
  "their activity log. If they ask for something you have no tool for — " +
  "sending mail, deleting anything, creating a calendar event — say it " +
  "has to be done from the dashboard rather than pretending. " +
  "Each event carries a `prep` checklist: what the user decided has to " +
  "happen before it, with `done` marking what's finished. When asked what " +
  "they need to do for an event, answer from that list — lead with the " +
  "unfinished items, and say what's already done rather than repeating it " +
  "as outstanding. An event with an empty `prep` array has no checklist " +
  "yet, which is not the same as having nothing to do: say no prep list " +
  "has been drafted for it, and mention they can draft one from the " +
  "Upcoming card. You may suggest what such a list might contain, but be " +
  "clear that you are suggesting rather than reading it back.";

// Nests each event's checklist inside the event itself. Handing the model
// two lists joined on an opaque key invites it to mismatch them, or to
// answer "nothing to prep" because the connection wasn't obvious. The
// internal fields go too — a key and a UID are noise it can't use, and
// they crowd the window on a long calendar.
function eventsForModel(
  events: EventSummary[],
  prep: Record<string, PrepItem[]>
) {
  return events.map((event) => ({
    title: event.summary,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location,
    attendeeCount: event.attendeeCount,
    calendar: event.calendarName,
    hasVideoLink: Boolean(event.hangoutLink),
    prep: (prep[event.key] ?? []).map((item) => ({
      task: item.title,
      done: item.done,
    })),
  }));
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) return null;

  const messages: ChatMessage[] = [];
  for (const entry of body.messages) {
    if (!entry || typeof entry !== "object") return null;
    const m = entry as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant") return null;
    if (typeof m.content !== "string") return null;
    messages.push({ role: m.role, content: m.content });
  }
  return messages;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = parseMessages(raw);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Invalid request body. Expected { messages: [{ role: 'user' | 'assistant', content: string }] } with at least one message.",
      },
      { status: 400 }
    );
  }

  // Keep only the tail of a long conversation. The oldest turns are the
  // least likely to matter and the most expensive to keep re-sending.
  const history = parsed.slice(-MAX_HISTORY);

  // The same profile the brief reads. Without it, chat answers "what
  // matters today?" generically while the brief directly above it names
  // the user's people — two answers from the same data, and the thinner
  // one looks like the app forgot who it was talking to.
  let profile: UserProfileRow | null = null;
  try {
    profile = await getProfile(userId);
  } catch (err) {
    console.error("Chat: profile unavailable", errorMessage(err));
  }

  let emails: {
    id: string;
    from: string;
    fromEmail: string;
    subject: string;
    snippet: string;
    date: string;
    unread: boolean;
  }[] = [];
  let events: EventSummary[] = [];
  let prep: Record<string, PrepItem[]> = {};
  let calendarUnavailable = false;
  let calendarTruncated = false;
  // Held beyond the fetch block because the tool layer needs it too — an
  // authorized client is the one thing every action has in common.
  let client: Awaited<ReturnType<typeof getAuthorizedClientForUser>> = null;

  try {
    client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Google not connected", code: "not_connected" },
        { status: 400 }
      );
    }

    // An account connected before the Calendar scope existed should still
    // be able to ask questions about its mail, so an unreachable calendar
    // degrades the answer rather than failing the request. gatherEvents
    // merges Google and Apple, so questions about the week cover both.
    const [messagesResult, eventsResult] = await Promise.allSettled([
      fetchRecentMessages(client, MESSAGE_LIMIT),
      gatherEvents(userId, CALENDAR_DAYS),
    ]);

    if (messagesResult.status === "rejected") throw messagesResult.reason;

    if (eventsResult.status === "fulfilled") {
      const { events: gathered, google, apple, truncated } = eventsResult.value;
      events = gathered;
      calendarTruncated = truncated;
      // Only "unavailable" when neither service came through — one
      // working source still answers most questions.
      calendarUnavailable = google !== "ok" && apple !== "ok";
      if (calendarUnavailable) {
        console.error(
          `Chat: calendar unavailable (google: ${google}, apple: ${apple})`
        );
      }

      // "What do I need to do before Thursday's review?" is the question
      // this whole feature exists to answer, so the checklists have to be
      // in context. Their absence is survivable — a chat answer without
      // prep is thinner, not wrong — so a failure here only degrades.
      try {
        prep = await listPrepItems(
          userId,
          events.map((event) => event.key)
        );
      } catch (err) {
        console.error("Chat: prep items unavailable", errorMessage(err));
      }
    } else {
      calendarUnavailable = true;
      console.error(
        "Chat: calendar unavailable",
        errorMessage(eventsResult.reason)
      );
    }

    // Unlike the brief, read mail is kept — a question can just as easily
    // be about something already opened.
    emails = messagesResult.value.map((m) => ({
      id: m.id,
      from: m.from,
      fromEmail: m.fromEmail,
      subject: m.subject,
      snippet: m.snippet.slice(0, SNIPPET_CHARS),
      date: m.date,
      unread: m.unread,
    }));
  } catch (err: unknown) {
    console.error("Chat data fetch failed", errorMessage(err));
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    return NextResponse.json(
      { error: "Failed to load your mail and calendar" },
      { status: code === 401 ? 401 : 500 }
    );
  }

  // Narrowed once here rather than asserted at each use: the fetch block
  // above returns early when there's no client, but TypeScript can't see
  // that through a reassignable binding.
  const authorized = client;
  if (!authorized) {
    return NextResponse.json(
      { error: "Google not connected", code: "not_connected" },
      { status: 400 }
    );
  }

  // Claude gets its own try/catch: the context loaded fine, so a generation
  // failure is recoverable and the UI should offer a retry rather than
  // reporting that everything broke.
  try {
    const timeZone = resolveTimezone(profile?.timezone);

    // What Nexus remembers, narrowed by the question itself rather than
    // by the mailbox — "what did I promise Marcus?" should reach the note
    // about Marcus even if he sent nothing this week.
    //
    // Chat reads memory but never writes it. Extraction lives in the
    // brief, which sees the whole day once; a chat turn sees a slice and
    // would learn the same fact from three different angles, three times.
    const lastUserMessage =
      [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    const remembered = await recallFacts(userId, lastUserMessage);

    const systemPrompt = [
      SYSTEM_PROMPT +
        profileToPromptContext(profile) +
        factsToPromptContext(remembered),
      "",
      ...nowLines(timeZone),
      "",
      calendarUnavailable
        ? "Calendar data is unavailable — answer from email alone, and say so if the user asks about their schedule."
        : `${
            calendarTruncated
              ? `This is a PARTIAL list — there are more events in the ` +
                `next ${CALENDAR_DAYS} days than were fetched. If asked ` +
                `about a date and you see nothing, say you can't see ` +
                `that far rather than saying they are free.\n`
              : ""
          }Upcoming events (next ${CALENDAR_DAYS} days):\n${JSON.stringify(
            eventsForModel(events, prep),
            null,
            2
          )}`,
      "",
      `Recent email:\n${JSON.stringify(emails, null, 2)}`,
    ].join("\n");

    const anthropic = getAnthropicClient();

    // The ids the model was actually shown. Every tool checks against
    // this, so an invented id can't reach Gmail — and a message the user
    // never saw in this conversation can't be acted on.
    const visibleIds = new Set(emails.map((email) => email.id));

    const conversation: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const performed: ActionRecord[] = [];
    let content = "";

    for (let pass = 0; pass <= MAX_TOOL_PASSES; pass += 1) {
      // On the final pass the tools are withheld, which forces an
      // answer instead of another action. Passing them every time meant
      // the budget could only be spent by cutting the model off
      // mid-sentence — after the mailbox had already been changed.
      const lastPass = pass === MAX_TOOL_PASSES;
      const response = await anthropic.messages.create({
        model: CHAT_MODEL,
        max_tokens: 4096,
        output_config: { effort: "low" },
        system: lastPass
          ? systemPrompt +
            " You have used your action budget for this turn. Do not " +
            "attempt anything further — tell the user what you did and " +
            "what is left."
          : systemPrompt,
        ...(lastPass ? {} : { tools: CHAT_TOOLS }),
        messages: conversation,
      });

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      if (text) content = text;

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );
      if (!toolUses.length) break;

      if (lastPass) {
        // Unreachable: no tools were offered on this pass.
        console.error("[chat] tool use returned with no tools offered");
        break;
      }

      conversation.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const outcome = await runChatTool(
          use.name,
          (use.input ?? {}) as Record<string, unknown>,
          { userId, client: authorized, profile },
          visibleIds
        );
        if (outcome.action) performed.push(outcome.action);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: outcome.result,
        });
      }

      conversation.push({ role: "user", content: results });
    }

    if (!content) {
      // Only a real failure when nothing happened. If actions were taken,
      // a missing summary is a presentation problem — throwing here would
      // 503 the request and discard the receipts for changes already made
      // to the mailbox.
      if (!performed.length) throw new Error("Claude returned no text content");
      content = performed.map((action) => action.summary).join("\n");
    }

    return NextResponse.json({
      reply: { role: "assistant" as const, content },
      // Surfaced separately from the prose so the UI can offer undo on
      // each one. A model saying "I archived those" is a claim; this is
      // the receipt.
      actions: performed.map((action) => ({
        id: action.id,
        summary: action.summary,
        undoable: action.undo !== "none",
      })),
    });
  } catch (err: unknown) {
    console.error("Chat generation failed", errorMessage(err));
    return NextResponse.json(
      {
        error: "Couldn't answer that just now.",
        code: "chat_unavailable",
      },
      { status: 503 }
    );
  }
}
