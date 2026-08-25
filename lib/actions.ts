import { getSupabaseAdmin, type ActionLogRow } from "./supabase";

// The action log: every change Nexus makes to someone's account, in one
// readable list.
//
// This exists because the reason people don't trust an assistant with
// their inbox is that it's a black box. A plain "here's everything I did
// for you this week" page is the cheapest trust you can buy, and it costs
// one table.
//
// Two rules hold the whole thing together:
//
//   - Every action route writes here. An action that isn't logged is an
//     action the user can't see, which is the failure mode this is meant
//     to prevent.
//   - Every row carries enough to undo itself. `undo` names the operation
//     and `target` names what to run it against — nothing has to be
//     reconstructed later from prose.

export type ActionKind =
  | "draft_reply"
  | "archive"
  | "label"
  // Creating or removing a Gmail filter. Distinct from `trash` because a
  // filter changes what happens to mail that hasn't arrived yet, which is
  // a different kind of promise than moving mail that already has.
  | "filter"
  | "trash"
  // Calendar writes. Separate kinds because their undos are asymmetric:
  // an added event deletes cleanly, a deleted one comes back as a new
  // event with a new id.
  | "event_create"
  | "event_delete"
  // Editing an event's own fields (title, time, location, description).
  // No dedicated undo kind for it below — reversing an edit would mean
  // snapshotting the pre-edit fields the way delete snapshots the whole
  // event, which isn't built yet, so these log with undo: "none".
  | "event_update";

export type UndoKind =
  | "delete_draft"
  | "unarchive"
  | "remove_label"
  | "remove_filter"
  | "untrash"
  | "delete_event"
  | "restore_event"
  | "none";

export type ActionRecord = {
  id: string;
  kind: ActionKind;
  summary: string;
  target: Record<string, string>;
  undo: UndoKind;
  undoneAt: string | null;
  createdAt: string;
};

function toActionRecord(row: ActionLogRow): ActionRecord {
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    target: row.target ?? {},
    undo: row.undo,
    undoneAt: row.undone_at,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

// Record something Nexus did.
//
// Deliberately never throws: a logging failure must not fail the action
// itself. A user whose draft was written but not logged is confused; a
// user whose draft failed because the log was down is worse off. The
// error is surfaced to the server console so the gap is visible to us.
export async function logAction(
  userId: string,
  action: {
    kind: ActionKind;
    summary: string;
    target: Record<string, string>;
    undo: UndoKind;
  }
): Promise<ActionRecord | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("action_log")
      .insert({
        user_id: userId,
        kind: action.kind,
        summary: action.summary,
        target: action.target,
        undo: action.undo,
      })
      .select("*")
      .single();

    if (error) throw error;
    return toActionRecord(data as ActionLogRow);
  } catch (err) {
    console.error("Action log write failed", err);
    return null;
  }
}

// Most recent actions first — the log is read as "what just happened",
// not as an archive.
export async function listActions(
  userId: string,
  limit = 50
): Promise<ActionRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("action_log")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as ActionLogRow[]).map(toActionRecord);
}

export async function getAction(
  userId: string,
  id: string
): Promise<ActionRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("action_log")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? toActionRecord(data as ActionLogRow) : null;
}

/**
 * Claim an action for undoing.
 *
 * Returns false when someone already claimed it. Two clicks on one Undo
 * button — easy to produce, since a slow unarchive leaves the button
 * live — would otherwise run the reversal twice, and `restore_event`
 * run twice means two calendar events and a second invitation to every
 * guest. Claiming first turns that into a no-op.
 */
export type ClaimResult = "won" | "lost" | "error";

export async function claimUndo(
  userId: string,
  id: string
): Promise<ClaimResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("action_log")
      .update({ undone_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id)
      // The condition is the lock: only one caller can win this.
      .is("undone_at", null)
      .select("id");

    // Three outcomes, not two. Collapsing an error into "lost" would tell
    // the user their action was undone when nothing ran — and the page
    // greys the row out, so they can't even retry without reloading.
    if (error) {
      console.error("Undo claim failed", error.message);
      return "error";
    }
    return (data ?? []).length > 0 ? "won" : "lost";
  } catch (err) {
    console.error(
      "Undo claim failed",
      err instanceof Error ? err.message : String(err)
    );
    return "error";
  }
}

/**
 * Hand a claim back when the reversal itself failed, so the user can try
 * again rather than seeing an action marked undone that wasn't.
 */
export async function releaseUndo(
  userId: string,
  id: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("action_log")
      .update({ undone_at: null })
      .eq("user_id", userId)
      .eq("id", id);
    if (error) {
      // Worth reporting rather than swallowing: a release that fails
      // leaves the row marked undone, and every later click short-
      // circuits on that mark, so the action can never be retried.
      console.error("Undo release failed", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "Undo release failed",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

// Rows are marked undone rather than deleted. "Nexus drafted this and
// then you undid it" is part of the history the log is for — erasing it
// would make the log less honest, not tidier.
//
// Superseded by claimUndo, which sets the same field up front so two
// clicks can't both reverse. Kept because it is the honest primitive for
// "mark this undone" and the next caller shouldn't reach for the lock by
// mistake; delete it if none appears.
export async function markUndone(userId: string, id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("action_log")
    .update({ undone_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}

// --- what an action records about itself --------------------------------
//
// `target` is a Record<string, string>, so nothing stops a writer using
// `ids` where the undo route reads `messageIds` — and that's not a
// hypothetical: chat's archive tool did exactly that, and every undo it
// offered answered 422 while the button reported nothing. A typo in a
// string key is invisible to the compiler and invisible to the user until
// the moment they need it to work.
//
// These builders and readers are the fix. Anything that logs an action or
// reverses one goes through them, so the key exists in one place and a
// mismatch is impossible rather than merely unlikely.

export const actionTarget = {
  draft(draftId: string, threadId: string): Record<string, string> {
    return { draftId, threadId };
  },
  messages(ids: string[], labelId?: string): Record<string, string> {
    return {
      messageIds: ids.join(","),
      ...(labelId ? { labelId } : {}),
    };
  },
  event(fields: Record<string, string>): Record<string, string> {
    return fields;
  },
};

export function readMessageIds(target: Record<string, string>): string[] {
  return (target.messageIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function readDraftId(target: Record<string, string>): string | null {
  return target.draftId || null;
}

export function readLabelId(target: Record<string, string>): string | null {
  return target.labelId || null;
}
