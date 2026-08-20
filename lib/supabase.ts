import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client. Uses the service role key so we can write
// user token rows without needing per-user Supabase auth — Clerk is the
// authority on who the user is, and every route that touches this client
// first calls auth() to get the Clerk user id.
//
// Never import this from a client component.

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type GoogleTokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expiry: string | null;
  scope: string | null;
  updated_at?: string;
};

// Apple has no OAuth for iCloud Calendar, so what we store is the user's
// Apple ID plus an app-specific password they generated themselves.
// `app_password` holds the ciphertext from lib/crypto.ts, never the raw
// password — it doesn't expire on its own, so it can't be treated as
// casually as a short-lived access token.
export type AppleCredentialRow = {
  user_id: string;
  apple_id: string;
  app_password: string;
  updated_at?: string;
};

// One checklist item hanging off a calendar event. `event_key` is the
// stable per-occurrence key from lib/events.ts, not a calendar's own id —
// see eventKey() there for why. The event title and start are snapshots
// taken when the item was created, so a checklist still reads sensibly
// (and can be swept up) after the event drops out of the fetch window.
export type PrepItemRow = {
  id: string;
  user_id: string;
  event_key: string;
  event_summary: string | null;
  event_start: string | null;
  title: string;
  done: boolean;
  origin: "claude" | "user";
  position: number;
  created_at?: string;
  updated_at?: string;
};

// Records that we've already asked Claude to draft a checklist for an
// event. Without it, an event whose suggestions the user deleted would
// get them regenerated on the next load — and an empty checklist would
// be indistinguishable from one never drafted.
export type PrepStateRow = {
  user_id: string;
  event_key: string;
  generated_at: string;
};

// One thing Nexus did to a user's account. `target` holds whatever the
// undo needs — a draft id, a list of message ids — as plain string values
// so the shape can vary by action without a migration per action type.
// `undone_at` being null is what "still in effect" means; rows are never
// deleted, so the history stays honest.
// One stored brief per user per day. The brief is the most expensive
// thing this app does — a multi-second model call over the whole inbox —
// and nothing about it changes between a page refresh and the tab being
// reopened five minutes later.
export type BriefCacheRow = {
  user_id: string;
  // The user's calendar day, YYYY-MM-DD, in their own timezone. Not the
  // server's: a cache keyed on a UTC day would expire mid-evening for
  // half the world.
  day: string;
  brief: unknown;
  created_at?: string;
};

// One row per brief actually emailed. Exists so a cron that runs every
// hour, retries, or overlaps with itself can't send the same morning
// twice — the one failure mode that would get the whole feature muted.
export type BriefDeliveryRow = {
  user_id: string;
  day: string;
  sent_at?: string;
};

export type ActionLogRow = {
  id: string;
  user_id: string;
  kind:
    | "draft_reply"
    | "archive"
    | "label"
    | "filter"
    | "trash"
    | "event_create"
    | "event_delete";
  summary: string;
  target: Record<string, string> | null;
  undo:
    | "delete_draft"
    | "unarchive"
    | "remove_label"
    | "remove_filter"
    | "untrash"
    | "delete_event"
    | "restore_event"
    | "none";
  undone_at: string | null;
  created_at?: string;
};

// Supabase rejects with a PostgrestError — a plain object, not an Error
// — so String(err) on it yields "[object Object]". Pull out whatever
// human-readable text is actually there.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; hint?: string; code?: string };
    const parts = [e.message, e.hint].filter(Boolean);
    if (parts.length) {
      return e.code ? `${parts.join(" ")} (code ${e.code})` : parts.join(" ");
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }
  return String(err);
}
