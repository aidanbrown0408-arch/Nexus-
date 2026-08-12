import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  CALENDAR_READONLY_SCOPE,
  getAuthorizedClientForUser,
  hasScope,
} from "@/lib/google";
import { fetchRecentMessages } from "@/lib/gmail";
import { fetchUpcomingEvents, type EventSummary } from "@/lib/calendar";
import { getAnthropicClient, BRIEF_MODEL } from "@/lib/anthropic";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pull a few more than we keep — most of the recent window is usually read,
// and unread is what the brief is about.
const MESSAGE_FETCH_LIMIT = 40;
const MAX_UNREAD = 15;
const SNIPPET_CHARS = 300;
const CALENDAR_DAYS = 2;

type Priority = {
  title: string;
  reason: string;
  source: "email" | "calendar" | "both";
  sourceId?: string;
};

type Brief = {
  greeting: string;
  headline: string;
  priorities: Priority[];
  scheduleNote: string;
  calendarUnavailable?: boolean;
};

const SYSTEM_PROMPT =
  "You are Nexus, a personal chief of staff. Given a user's unread email and " +
  "upcoming calendar events, produce a short morning brief. Lead with what " +
  "needs a decision or reply today. Surface real connections between an email " +
  "and a calendar event when they genuinely relate — do not force a connection " +
  "that isn't there. Be specific: name the person, the topic, the time. If " +
  "nothing is urgent, say so plainly and do not manufacture urgency. Never " +
  "invent details that aren't in the data provided.";

// The brief comes back as tool input rather than prose, so the shape is
// enforced by the schema instead of parsed out of free text.
const BRIEF_TOOL = {
  name: "write_brief",
  description: "Record the morning brief for the user.",
  input_schema: {
    type: "object" as const,
    properties: {
      greeting: {
        type: "string",
        description: "One line, e.g. 'Three things need you today.'",
      },
      headline: {
        type: "string",
        description: "The single most important thing, 1-2 sentences.",
      },
      priorities: {
        type: "array",
        maxItems: 5,
        description: "Up to 5 things that need the user today. May be empty.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "The action, short." },
            reason: {
              type: "string",
              description: "Why it matters today, specific and grounded.",
            },
            source: {
              type: "string",
              enum: ["email", "calendar", "both"],
              description: "Where this came from. Use 'both' only for a real link.",
            },
            sourceId: {
              type: "string",
              description: "Id of the originating message or event, if any.",
            },
          },
          required: ["title", "reason", "source"],
        },
      },
      scheduleNote: {
        type: "string",
        description: "One line on the shape of the day.",
      },
    },
    required: ["greeting", "headline", "priorities", "scheduleNote"],
  },
};

// Today or tomorrow in the server's timezone. All-day events carry a bare
// YYYY-MM-DD, so compare on local date strings rather than instants.
function isTodayOrTomorrow(event: EventSummary): boolean {
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return false;

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const day = start.toDateString();
  return day === now.toDateString() || day === tomorrow.toDateString();
}

function isBrief(value: unknown): value is Omit<Brief, "calendarUnavailable"> {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  if (
    typeof b.greeting !== "string" ||
    typeof b.headline !== "string" ||
    typeof b.scheduleNote !== "string" ||
    !Array.isArray(b.priorities)
  ) {
    return false;
  }
  return b.priorities.every((p) => {
    if (!p || typeof p !== "object") return false;
    const item = p as Record<string, unknown>;
    return (
      typeof item.title === "string" &&
      typeof item.reason === "string" &&
      (item.source === "email" ||
        item.source === "calendar" ||
        item.source === "both") &&
      (item.sourceId === undefined || typeof item.sourceId === "string")
    );
  });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let narrowedEmails: {
    id: string;
    from: string;
    fromEmail: string;
    subject: string;
    snippet: string;
    date: string;
  }[] = [];
  let narrowedEvents: EventSummary[] = [];
  let calendarUnavailable = false;

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Google not connected", code: "not_connected" },
        { status: 400 }
      );
    }

    // Calendar is optional here in a way it isn't on its own route: an account
    // connected before the Calendar scope existed should still get a brief
    // built from email, flagged so the UI can say so.
    const calendarGranted = hasScope(
      client.credentials.scope,
      CALENDAR_READONLY_SCOPE
    );

    const [messagesResult, eventsResult] = await Promise.allSettled([
      fetchRecentMessages(client, MESSAGE_FETCH_LIMIT),
      calendarGranted
        ? fetchUpcomingEvents(client, CALENDAR_DAYS)
        : Promise.reject(new Error("calendar scope not granted")),
    ]);

    if (messagesResult.status === "rejected") throw messagesResult.reason;

    if (eventsResult.status === "fulfilled") {
      narrowedEvents = eventsResult.value.filter(isTodayOrTomorrow);
    } else {
      calendarUnavailable = true;
      console.error(
        "Brief: calendar unavailable",
        errorMessage(eventsResult.reason)
      );
    }

    narrowedEmails = messagesResult.value
      .filter((m) => m.unread)
      .slice(0, MAX_UNREAD)
      .map((m) => ({
        id: m.id,
        from: m.from,
        fromEmail: m.fromEmail,
        subject: m.subject,
        snippet: m.snippet.slice(0, SNIPPET_CHARS),
        date: m.date,
      }));
  } catch (err: unknown) {
    console.error("Brief data fetch failed", errorMessage(err));
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    return NextResponse.json(
      { error: "Failed to load your mail and calendar" },
      { status: code === 401 ? 401 : 500 }
    );
  }

  // Nothing to summarize — say so rather than paying for a call that would
  // have to invent something.
  if (!narrowedEmails.length && !narrowedEvents.length) {
    const brief: Brief = {
      greeting: "Nothing urgent right now.",
      headline:
        "No unread mail and nothing on your calendar for today or tomorrow.",
      priorities: [],
      scheduleNote: "Your next two days are clear.",
      ...(calendarUnavailable ? { calendarUnavailable: true } : {}),
    };
    return NextResponse.json({ brief });
  }

  // Claude gets its own try/catch: the mail and calendar data loaded fine, so
  // a generation failure is a smaller problem than a fetch failure and the UI
  // should be able to say "retry" rather than "something broke".
  try {
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 4096,
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      tools: [BRIEF_TOOL],
      tool_choice: { type: "tool", name: "write_brief" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Today is ${now.toDateString()}.`,
                `The current time is ${now.toLocaleTimeString()}.`,
                `The timezone is ${timeZone}.`,
                "",
                calendarUnavailable
                  ? "Calendar data is unavailable — write the brief from email alone and do not refer to meetings."
                  : `Events today and tomorrow:\n${JSON.stringify(narrowedEvents, null, 2)}`,
                "",
                `Unread email:\n${JSON.stringify(narrowedEmails, null, 2)}`,
              ].join("\n"),
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use" || !isBrief(toolUse.input)) {
      throw new Error("Claude did not return a brief matching the schema");
    }

    const brief: Brief = {
      ...toolUse.input,
      priorities: toolUse.input.priorities.slice(0, 5),
      ...(calendarUnavailable ? { calendarUnavailable: true } : {}),
    };

    return NextResponse.json({ brief });
  } catch (err: unknown) {
    console.error("Brief generation failed", errorMessage(err));
    return NextResponse.json(
      {
        error: "Couldn't generate your brief just now.",
        code: "brief_unavailable",
      },
      { status: 503 }
    );
  }
}
