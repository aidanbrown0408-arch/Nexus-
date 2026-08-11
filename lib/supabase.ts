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
