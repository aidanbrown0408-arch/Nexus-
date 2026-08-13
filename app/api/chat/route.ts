import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  CALENDAR_READONLY_SCOPE,
  getAuthorizedClientForUser,
  hasScope,
} from "@/lib/google";
import { fetchRecentMessages } from "@/lib/gmail";
import { fetchUpcomingEvents, type EventSummary } from "@/lib/calendar";
import { getAnthropicClient, CHAT_MODEL } from "@/lib/anthropic";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chat questions aren't limited to today the way the brief is, so the
// window is wider on both sides.
const MESSAGE_LIMIT = 20;
const SNIPPET_CHARS = 300;
const CALENDAR_DAYS = 7;
const MAX_HISTORY = 20;

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
  "emails, events, or details that aren't there.";

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
  let calendarUnavailable = false;

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Google not connected", code: "not_connected" },
        { status: 400 }
      );
    }

    // An account connected before the Calendar scope existed should still
    // be able to ask questions about its mail, so a missing scope degrades
    // the answer rather than failing the request.
    const calendarGranted = hasScope(
      client.credentials.scope,
      CALENDAR_READONLY_SCOPE
    );

    const [messagesResult, eventsResult] = await Promise.allSettled([
      fetchRecentMessages(client, MESSAGE_LIMIT),
      calendarGranted
        ? fetchUpcomingEvents(client, CALENDAR_DAYS)
        : Promise.reject(new Error("calendar scope not granted")),
    ]);

    if (messagesResult.status === "rejected") throw messagesResult.reason;

    if (eventsResult.status === "fulfilled") {
      events = eventsResult.value;
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

  // Claude gets its own try/catch: the context loaded fine, so a generation
  // failure is recoverable and the UI should offer a retry rather than
  // reporting that everything broke.
  try {
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const systemPrompt = [
      SYSTEM_PROMPT,
      "",
      `Today is ${now.toDateString()}.`,
      `The current time is ${now.toLocaleTimeString()}.`,
      `The timezone is ${timeZone}.`,
      "",
      calendarUnavailable
        ? "Calendar data is unavailable — answer from email alone, and say so if the user asks about their schedule."
        : `Upcoming events (next ${CALENDAR_DAYS} days):\n${JSON.stringify(events, null, 2)}`,
      "",
      `Recent email:\n${JSON.stringify(emails, null, 2)}`,
    ].join("\n");

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 4096,
      output_config: { effort: "low" },
      system: systemPrompt,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    });

    const content = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    if (!content) throw new Error("Claude returned no text content");

    return NextResponse.json({
      reply: { role: "assistant" as const, content },
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
