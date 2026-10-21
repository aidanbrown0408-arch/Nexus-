import { NextResponse } from "next/server";
import { getSupabaseAdmin, errorMessage } from "./supabase";

// Per-user ceilings on the routes that cost money every time they run —
// a model call or a text-to-speech request. Set well above what one
// person uses in a normal day; they exist so a stuck client loop, a
// script, or one abusive account can't run up the bill for everyone.
//
// Counted in Postgres (migrations/003-launch-hardening.sql) rather than
// in memory, because serverless instances don't share memory and a
// per-instance counter is no limit at all.
export const RATE_LIMITS = {
  chat: { limit: 120, windowSeconds: 3600 },
  brief: { limit: 30, windowSeconds: 3600 },
  draft: { limit: 60, windowSeconds: 3600 },
  triage: { limit: 30, windowSeconds: 3600 },
  prep: { limit: 60, windowSeconds: 3600 },
  filter: { limit: 40, windowSeconds: 3600 },
  speech: { limit: 300, windowSeconds: 3600 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

let warnedMissing = false;

// True when the request may go ahead.
//
// Fails open: if the counter itself is unavailable (Supabase down, or the
// migration not yet applied) the request proceeds and the problem is
// logged. Locking every user out of the product because a guard rail
// is missing is the worse failure.
export async function allowRequest(
  userId: string,
  bucket: RateLimitBucket
): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  try {
    const { data, error } = await getSupabaseAdmin().rpc("nexus_rate_limit_hit", {
      p_user_id: userId,
      p_bucket: bucket,
      p_window_seconds: windowSeconds,
      p_limit: limit,
    });
    if (error) throw error;
    return data !== false;
  } catch (err) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error(
        "[rate-limit] counter unavailable — requests are not being limited. " +
          "Has migrations/003-launch-hardening.sql been applied?",
        errorMessage(err)
      );
    }
    return true;
  }
}

export function rateLimitedResponse() {
  return NextResponse.json(
    {
      error: "You're going a little fast — give it a few minutes and try again.",
      code: "rate_limited",
    },
    { status: 429, headers: { "Retry-After": "600" } }
  );
}
