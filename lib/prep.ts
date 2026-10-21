import {
  getSupabaseAdmin,
  type PrepItemRow,
  type PrepSource,
} from "./supabase";
import { generateStructured, PREP_MODEL } from "./anthropic";
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
  // Null for a reminder that belongs to no meeting.
  eventKey: string | null;
  title: string;
  done: boolean;
  origin: PrepOrigin;
  // The item's own date. Null on an event-linked item, which is due when
  // its event is — see effectiveDate().
  dueAt: string | null;
  source: PrepSource;
  sourceRef: Record<string, string> | null;
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
    dueAt: row.due_at ?? null,
    // Defaulted rather than asserted: a row written before this column
    // existed is event prep, which is exactly what the default says.
    source: row.source ?? "event",
    sourceRef: row.source_ref ?? null,
    position: row.position,
  };
}

// The one date every list sorts and groups on.
//
// An item's own due date wins; an event-linked item with none is due when
// its event is. Keeping this in one function is the point — two places
// deciding what "when is this due" means is how an item ends up under
// Today in one view and Overdue in another.
export function effectiveDate(item: {
  dueAt?: string | null;
  eventStart?: string | null;
}): string | null {
  return item.dueAt ?? item.eventStart ?? null;
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
    // The .in() filter can't match a null, so this is belt-and-braces —
    // but the type is honest now that standalone items exist, and an
    // "undefined" key silently collecting rows would be a bad bug.
    if (!row.event_key) continue;
    (grouped[row.event_key] ??= []).push(toPrepItem(row));
  }
  return grouped;
}

// Every open item across every event, newest events first — the "what do I
// actually have to do" view, as opposed to the per-event panel.
//
// Reads only prep_items: each row already carries the event's title and
// start denormalized, so this never touches Google or iCloud. That matters
// more than it saves — the to-do list stays readable when a calendar is
// unreachable, and an item survives on the list even if the event it hangs
// off has since been deleted.
const TODO_LOOKBACK_DAYS = 14;
const TODO_LIMIT = 500;

export type PrepTodo = PrepItem & {
  // Null on a standalone reminder — there is no event to name.
  eventSummary: string | null;
  eventStart: string | null;
};

export async function listTodoItems(
  userId: string,
  options: { includeDone?: boolean } = {}
): Promise<PrepTodo[]> {
  const supabase = getSupabaseAdmin();

  // A fortnight back, not from today: an item you didn't get to before
  // Tuesday's meeting is exactly the thing a to-do list should still be
  // showing you on Wednesday.
  const since = new Date();
  since.setDate(since.getDate() - TODO_LOOKBACK_DAYS);
  const cutoff = since.toISOString();

  // Three ways a row can earn its place: its own due date is recent
  // enough, its event is, or it has neither and is undated — which is a
  // reminder with no deadline, not an expired one. A bare gte would drop
  // all three of the null cases, since NULL fails every comparison, and
  // they'd vanish from the list with nothing to explain why.
  let query = supabase
    .from("prep_items")
    .select("*")
    .eq("user_id", userId)
    .or(
      [
        `due_at.gte.${cutoff}`,
        `and(due_at.is.null,event_start.gte.${cutoff})`,
        `and(due_at.is.null,event_start.is.null)`,
      ].join(",")
    )
    .limit(TODO_LIMIT);

  if (!options.includeDone) query = query.eq("done", false);

  const { data, error } = await query;
  if (error) throw error;

  const items = ((data ?? []) as PrepItemRow[]).map((row) => ({
    ...toPrepItem(row),
    // Kept null rather than filled with a placeholder: the caption on a
    // standalone row should say nothing, not "Untitled event".
    eventSummary: row.event_key ? row.event_summary?.trim() || "Untitled event" : null,
    eventStart: row.event_start,
  }));

  // Sorted here, not in Postgres. The order that matters is by effective
  // date, and that's `due_at ?? event_start` — one expression across two
  // columns, which no combination of .order() calls can express. The set
  // is capped at TODO_LIMIT, so this is a few hundred rows at worst.
  return items.sort((a, b) => {
    const aDate = effectiveDate(a);
    const bDate = effectiveDate(b);

    // Undated last. Something with no deadline shouldn't sit above
    // tomorrow's, and it has no position on the timeline to claim.
    if (!aDate && !bDate) return tieBreak(a, b);
    if (!aDate) return 1;
    if (!bDate) return -1;

    const diff = Date.parse(aDate) - Date.parse(bDate);
    return diff !== 0 ? diff : tieBreak(a, b);
  });
}

// Two items due at the same instant are almost always two items on the
// same event's checklist, where the user's own ordering is the answer.
function tieBreak(a: PrepTodo, b: PrepTodo): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

// A reminder that belongs to no meeting — the "call the dentist Friday"
// case, which is most of what a to-do list actually holds.
//
// No position lookup: position orders one event's checklist, and there is
// no checklist here to be third in. It stays 0, and the list falls back
// to id for a stable order among items due at the same instant.
export async function createTask(
  userId: string,
  task: {
    title: string;
    dueAt?: string | null;
    source?: Exclude<PrepSource, "event">;
    sourceRef?: Record<string, string> | null;
  }
): Promise<PrepTodo> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("prep_items")
    .insert({
      user_id: userId,
      event_key: null,
      title: task.title.slice(0, MAX_TITLE_LENGTH),
      // Always the user's own. `origin` says who wrote the words, and
      // even a task Nexus files from chat is the user's request in the
      // user's phrasing — unlike a drafted prep suggestion, which
      // generation is allowed to replace.
      origin: "user",
      due_at: task.dueAt ?? null,
      source: task.source ?? "manual",
      source_ref: task.sourceRef ?? null,
      position: 0,
    })
    .select("*")
    .single();

  if (error) throw error;

  const row = data as PrepItemRow;
  return { ...toPrepItem(row), eventSummary: null, eventStart: null };
}

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
      source: "event",
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
  patch: { done?: boolean; title?: string; dueAt?: string | null }
): Promise<PrepItem | null> {
  const supabase = getSupabaseAdmin();

  const update: Partial<PrepItemRow> = { updated_at: new Date().toISOString() };
  if (typeof patch.done === "boolean") update.done = patch.done;
  if (typeof patch.title === "string") {
    update.title = patch.title.slice(0, MAX_TITLE_LENGTH);
  }
  // `undefined` means "not in this patch"; an explicit null means "clear
  // the date". They have to stay distinguishable — moving an item back to
  // No date is a thing people do.
  if (patch.dueAt !== undefined) update.due_at = patch.dueAt;

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
  const timeZone = resolveTimezone(profile?.timezone);

  const output = await generateStructured({
    model: PREP_MODEL,
    max_tokens: 4096,
    effort: "low",
    system: SYSTEM_PROMPT + profileToPromptContext(profile),
    schema: PREP_TOOL.input_schema,
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

  if (!isPrepList(output)) {
    throw new Error("Claude did not return a prep list matching the schema");
  }

  const seen = new Set<string>();
  return output.items
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
