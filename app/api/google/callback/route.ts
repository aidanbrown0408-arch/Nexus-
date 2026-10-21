import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  CALENDAR_EVENTS_SCOPE,
  getOAuthClient,
  hasScope,
  missingScopes,
  OAUTH_STATE_COOKIE,
} from "@/lib/google";
import { secretsMatch } from "@/lib/crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function dashboardUrl(req: NextRequest, params: Record<string, string> = {}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const url = new URL("/dashboard", base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

// Every exit from this route goes through here, so the one-time state
// cookie is cleared whether the flow succeeded, was denied, or was
// rejected. A nonce that has been presented once is spent.
function leave(req: NextRequest, params: Record<string, string> = {}) {
  const response = NextResponse.redirect(dashboardUrl(req, params));
  response.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return leave(req, { google: "unauthorized" });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return leave(req, { google: "denied" });
  }
  // The state has to match the nonce this browser was issued when it
  // started the flow, and that nonce has to have been issued to *this*
  // signed-in user. Comparing against the user id alone accepted any
  // code paired with a guessable value — see the connect route.
  const stored = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const separator = stored.lastIndexOf(":");
  const expectedNonce = separator === -1 ? "" : stored.slice(0, separator);
  const statedUser = separator === -1 ? "" : stored.slice(separator + 1);

  if (
    !code ||
    !state ||
    !expectedNonce ||
    !secretsMatch(state, expectedNonce) ||
    statedUser !== userId
  ) {
    console.warn(`Google OAuth callback rejected for ${userId}: bad state`);
    return leave(req, { google: "error" });
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);

    const supabase = getSupabaseAdmin();

    // What's already stored, so a reconnect can't come out worse than
    // the connection it replaced. Google omits `refresh_token` on a
    // re-consent it decides is redundant, and this upsert wrote the
    // omission straight in as null — turning a working connection into
    // one that can't refresh. Same for `scope`.
    const { data: existing } = await supabase
      .from("google_tokens")
      .select("refresh_token, scope")
      .eq("user_id", userId)
      .maybeSingle<{ refresh_token: string | null; scope: string | null }>();

    const scope = tokens.scope ?? existing?.scope ?? null;

    const { error } = await supabase.from("google_tokens").upsert(
      {
        user_id: userId,
        access_token: tokens.access_token ?? "",
        refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
        token_expiry: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) throw error;

    // Google's consent screen is a list of checkboxes, and "Continue"
    // works with any subset ticked. Reporting a plain "connected" after
    // a half-granted consent is how someone reconnects to fix a
    // permission error, sees a success banner, and hits the identical
    // error on the next click. Name it instead.
    const missing = missingScopes(scope);
    if (missing.length > 0) {
      console.warn(
        `Google connected for ${userId} without ${missing.length} scope(s):`,
        missing.join(" ")
      );
      return leave(req, {
        google: "partial",
        // The calendar write scope is the one with a visible symptom,
        // so the banner can be specific about it.
        calendarWrite: hasScope(scope, CALENDAR_EVENTS_SCOPE) ? "yes" : "no",
      });
    }

    return leave(req, { google: "connected" });
  } catch (err) {
    console.error("Gmail OAuth callback failed", err);
    return leave(req, { google: "error" });
  }
}
