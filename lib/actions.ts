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
  | "event_delete";

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

// Rows are marked undone rather than deleted. "Nexus drafted this and
// then you undid it" is part of the history the log is for — erasing it
// would make the log less honest, not tidier.
export async function markUndone(userId: string, id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("action_log")
    .update({ undone_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}
