import { getSupabaseAdmin, type PrepItemRow } from "./supabase";
import { getAnthropicClient, PREP_MODEL } from "./anthropic";
import { nowLines, resolveTimezone } from "./clock";
import {
  getProfile,
  profileToPromptContext,
  type UserProfileRow,
} from "./profile";
import { errorMessage } from "./supabase";
import type { EventSummary } from "./events";

// Prep checklists: the small set of things that have to be done *before*
// an event, hanging off that event.
//
// Claude drafts the first pass from what the event and the user's mail
// already say; the user owns it after that. Two rules follow from that
// split and shape most of this file:
//
//   - Generation happens once per event, on request. Redrafting on every
//     load would fight the user's edits and spend a model call to do it.
//   - A user's own items are never touched by generation. Only Claude's
//     untouched suggestions can be replaced.

const MAX_SUGGESTIONS = 6;
export const MAX_TITLE_LENGTH = 200;

export type PrepOrigin = "claude" | "user";

export type PrepItem = {
  id: string;
  eventKey: string;
  title: string;
  done: boolean;
  origin: PrepOrigin;
  position: number;
};

export type PrepEventContext = {
  key: string;
  summary: string;
  start: string;
};

function toPrepItem(row: PrepItemRow): PrepItem {
  return {
    id: row.id,
    eventKey: row.event_key,
    title: row.title,
    done: row.done,
    origin: row.origin,
    position: row.position,
  };
}

// --- reads --------------------------------------------------------------

// Items for a set of events, grouped by event key. The calendar route
// calls this with every event it's about to return, so the whole card
// renders from one round trip instead of one request per event.
export async function listPrepItems(
  userId: string,
  eventKeys: string[]
): Promise<Record<string, PrepItem[]>> {
  const grouped: Record<string, PrepItem[]> = {};
  if (!eventKeys.length) return grouped;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prep_items")
    .select("*")
    .eq("user_id", userId)
    .in("event_key", eventKeys)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  for (const row of (data ?? []) as PrepItemRow[]) {
    (grouped[row.event_key] ??= []).push(toPrepItem(row));
  }
  return grouped;
}

// Which of these events have already had a checklist drafted. Used to
// decide whether to offer "Draft prep" or leave the event alone — an
// event whose suggestions were all deleted should stay deleted.
export async function listGeneratedKeys(
  userId: string,
  eventKeys: string[]
): Promise<string[]> {
  if (!eventKeys.length) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("prep_generations")
    .select("event_key")
    .eq("user_id", userId)
    .in("event_key", eventKeys);

  if (error) throw error;
  return (data ?? []).map((row) => (row as { event_key: string }).event_key);
}

// --- writes -------------------------------------------------------------

export async function createPrepItem(
  userId: string,
  event: PrepEventContext,
  title: string,
  origin: PrepOrigin
): Promise<PrepItem> {
  const supabase = getSupabaseAdmin();

  // Append to the end of whatever's already there. Two items added in the
  // same second would otherwise sort arbitrarily.
  const { data: existing, error: countError } = await supabase
    .from("prep_items")
    .select("position")
    .eq("user_id", userId)
    .eq("event_key", event.key)
    .order("position", { ascending: false })
    .limit(1);

  if (countError) throw countError;
  const nextPosition = ((existing?.[0] as { position?: number })?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("prep_items")
    .insert({
      user_id: userId,
      event_key: event.key,
      event_summary: event.summary,
      event_start: event.start,
      title: title.slice(0, MAX_TITLE_LENGTH),
      origin,
      position: nextPosition,
    })
    .select("*")
    .single();

  if (error) throw error;
  return toPrepItem(data as PrepItemRow);
}

// Every write filters on user_id as well as id. The service role key
// bypasses RLS, so this is the only thing standing between one user's id
// and another user's rows.
export async function updatePrepItem(
  userId: string,
  id: string,
  patch: { done?: boolean; title?: string }
): Promise<PrepItem | null> {
  const supabase = getSupabaseAdmin();

  const update: Partial<PrepItemRow> = { updated_at: new Date().toISOString() };
  if (typeof patch.done === "boolean") update.done = patch.done;
  if (typeof patch.title === "string") {
    update.title = patch.title.slice(0, MAX_TITLE_LENGTH);
  }

  const { data, error } = await supabase
    .from("prep_items")
    .update(update)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data ? toPrepItem(data as PrepItemRow) : null;
}

export async function deletePrepItem(
  userId: string,
  id: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("prep_items")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}

async function markGenerated(userId: string, eventKey: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("prep_generations").upsert(
    {
      user_id: userId,
      event_key: eventKey,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,event_key" }
  );
  if (error) throw error;
}

// Clear out Claude's previous suggestions before a redraft. Anything the
// user typed, edited, or already ticked off stays — redrafting shouldn't
// be able to destroy work.
async function clearUntouchedSuggestions(
  userId: string,
  eventKey: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("prep_items")
    .delete()
    .eq("user_id", userId)
    .eq("event_key", eventKey)
    .eq("origin", "claude")
    .eq("done", false);
  if (error) throw error;
}

// --- generation ---------------------------------------------------------

export type RelatedEmail = {
  from: string;
  subject: string;
  snippet: string;
};

const SYSTEM_PROMPT =
  "You are Nexus, a personal chief of staff. Given one upcoming calendar " +
  "event and any related email, list what the user must do BEFORE it " +
  "starts so they arrive ready. Be concrete and specific to this event: " +
  "name the document, the person, the thing to bring or send. Prefer " +
  "items grounded in the email context over generic advice. Do not " +
  "restate the event itself, do not include attending it, and do not pad " +
  "the list — two real items beat six filler ones. If genuinely nothing " +
  "needs doing beforehand, return an empty list.";

const PREP_TOOL = {
  name: "write_prep_list",
  description: "Record what needs doing before this event.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        maxItems: MAX_SUGGESTIONS,
        description:
          "Things to do before the event. May be empty. Each is a short " +
          "imperative phrase, e.g. 'Send Sarah the Q3 numbers'.",
        items: { type: "string" },
      },
    },
    required: ["items"],
  },
};

function isPrepList(value: unknown): value is { items: string[] } {
  if (!value || typeof value !== "object") return false;
  const v = value as { items?: unknown };
  return (
    Array.isArray(v.items) && v.items.every((i) => typeof i === "string")
  );
}

// Ask Claude what this event needs. Returns the titles only — persisting
// them is the caller's job, so a model failure can't leave half a
// checklist behind.
export async function draftPrepTitles(
  event: EventSummary,
  relatedEmails: RelatedEmail[],
  profile: UserProfileRow | null = null
): Promise<string[]> {
  const anthropic = getAnthropicClient();
  const timeZone = resolveTimezone(profile?.timezone);

  const response = await anthropic.messages.create({
    model: PREP_MODEL,
    max_tokens: 2048,
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT + profileToPromptContext(profile),
    tools: [PREP_TOOL],
    tool_choice: { type: "tool", name: "write_prep_list" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              ...nowLines(timeZone),
              "",
              "Event:",
              JSON.stringify(
                {
                  title: event.summary,
                  start: event.start,
                  end: event.end,
                  allDay: event.allDay,
                  location: event.location,
                  attendees: event.attendees,
                  calendar: event.calendarName,
                  hasVideoLink: Boolean(event.hangoutLink),
                },
                null,
                2
              ),
              "",
              relatedEmails.length
                ? `Email that may relate to it:\n${JSON.stringify(relatedEmails, null, 2)}`
                : "No related email found.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || !isPrepList(toolUse.input)) {
    throw new Error("Claude did not return a prep list matching the schema");
  }

  const seen = new Set<string>();
  return toolUse.input.items
    .map((title) => title.trim())
    .filter((title) => {
      if (!title) return false;
      // Same item phrased twice is worse than one fewer item.
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS)
    .map((title) => title.slice(0, MAX_TITLE_LENGTH));
}

// Draft and persist in one step: the whole point of the feature is that
// the list is there next time, so a suggestion that isn't saved isn't
// worth showing.
export async function generatePrepItems(
  userId: string,
  event: EventSummary,
  relatedEmails: RelatedEmail[]
): Promise<PrepItem[]> {
  // What the user does shapes what a meeting needs preparing. "Board
  // sync" means something different to a founder and to an engineer, and
  // the interview already knows which one this is.
  let profile: UserProfileRow | null = null;
  try {
    profile = await getProfile(userId);
  } catch (err) {
    console.error("Prep: profile unavailable", errorMessage(err));
  }

  const titles = await draftPrepTitles(event, relatedEmails, profile);

  await clearUntouchedSuggestions(userId, event.key);

  const context: PrepEventContext = {
    key: event.key,
    summary: event.summary,
    // All-day events carry a bare date; timestamptz takes either, but
    // normalize so ordering by event_start works across both.
    start: new Date(event.start).toISOString(),
  };

  // Sequential rather than Promise.all: createPrepItem reads the current
  // max position to append, and parallel inserts would all read the same
  // one and collide on ordering.
  const created: PrepItem[] = [];
  for (const title of titles) {
    created.push(await createPrepItem(userId, context, title, "claude"));
  }

  // Recorded even when the list came back empty — "Claude looked and
  // found nothing" is a real answer, and re-asking would just spend
  // another call to reach it.
  await markGenerated(userId, event.key);

  return created;
}

// Mail that plausibly relates to an event: same people, or overlapping
// wording in the subject. Deliberately cheap and local — the alternative
// is a Gmail search per event, and this runs against messages the app
// has already fetched.
export function findRelatedEmails<
  T extends { from: string; fromEmail: string; subject: string; snippet: string }
>(event: EventSummary, emails: T[], limit = 5): RelatedEmail[] {
  const attendees = new Set(
    event.attendees.map((email) => email.toLowerCase())
  );

  // Words from the title worth matching on. Short ones ("the", "1:1")
  // and calendar filler ("meeting", "call") match everything.
  const stopWords = new Set([
    "meeting",
    "call",
    "sync",
    "catch",
    "chat",
    "with",
    "and",
    "the",
    "for",
    "review",
    "weekly",
    "monthly",
  ]);
  const titleWords = event.summary
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  const scored = emails
    .map((email) => {
      let score = 0;
      if (attendees.has(email.fromEmail.toLowerCase())) score += 3;
      const haystack = `${email.subject} ${email.snippet}`.toLowerCase();
      for (const word of titleWords) {
        if (haystack.includes(word)) score += 1;
      }
      return { email, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ email }) => ({
    from: email.from,
    subject: email.subject,
    snippet: email.snippet.slice(0, 300),
  }));
}
