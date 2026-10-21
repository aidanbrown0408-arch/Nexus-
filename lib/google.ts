import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getSupabaseAdmin, type GoogleTokenRow } from "./supabase";

// The httpOnly cookie that carries the OAuth `state` nonce between the
// connect redirect and the callback. See app/api/google/connect/route.ts
// for why the state is a random nonce rather than the user id.
export const OAUTH_STATE_COOKIE = "nexus_google_oauth_state";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
// Creates and updates drafts. Deliberately not gmail.send: a draft that
// can't be sent without the user opening Gmail is the whole safety
// argument for shipping this action first. Widening it later is a
// decision, not an oversight.
export const GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
// Creates the native Gmail filters that route incoming mail. Settings
// only — it can't read or move a single message on its own.
export const GMAIL_SETTINGS_SCOPE =
  "https://www.googleapis.com/auth/gmail.settings.basic";
// Moves existing mail to Trash when sweeping a backlog. Still not
// gmail.delete: everything Nexus removes lands in Trash, where Gmail
// keeps it for 30 days and the undo route can put it back.
export const GMAIL_MODIFY_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";
// Creating and deleting calendar events. The first scope that lets Nexus
// do something other people find out about — deleting a meeting emails
// its guests, and no undo un-sends that. The routes treat it accordingly.
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
// Reading saved contacts, so guests can be picked by name instead of
// typed from memory. Read-only — Nexus never writes to the address book.
export const CONTACTS_SCOPE =
  "https://www.googleapis.com/auth/contacts.readonly";
// People the user has emailed but never saved. Most of the addresses
// anyone actually invites live here rather than in the address book, so
// without it the picker knows far less than the user expects.
export const OTHER_CONTACTS_SCOPE =
  "https://www.googleapis.com/auth/contacts.other.readonly";

// Every Google scope the app asks for at connect time. One consent
// covers all of them, so new APIs get appended here rather than getting
// a connect flow of their own.
export const GOOGLE_SCOPES = [
  GMAIL_READONLY_SCOPE,
  CALENDAR_READONLY_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_SETTINGS_SCOPE,
  GMAIL_MODIFY_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  CONTACTS_SCOPE,
  OTHER_CONTACTS_SCOPE,
];

// Whether a stored scope string covers a given scope. Google returns
// the granted scopes space-separated, so match on exact members rather
// than a substring — one scope URL can be a prefix of another.
export function hasScope(
  storedScope: string | null | undefined,
  scope: string
): boolean {
  if (!storedScope) return false;
  return storedScope.split(/\s+/).includes(scope);
}

// The scopes that let Nexus change something rather than just read it.
// Checked as a group after consent, because Google's consent screen has
// a checkbox per scope and a user can grant the read half and skip the
// write half without anything downstream noticing — which is exactly
// how a "connected" account ends up 403ing every delete.
export const GOOGLE_WRITE_SCOPES = [
  GMAIL_COMPOSE_SCOPE,
  GMAIL_SETTINGS_SCOPE,
  GMAIL_MODIFY_SCOPE,
  CALENDAR_EVENTS_SCOPE,
];

// Which of everything we asked for didn't come back granted.
export function missingScopes(
  storedScope: string | null | undefined,
  wanted: string[] = GOOGLE_SCOPES
): string[] {
  return wanted.filter((scope) => !hasScope(storedScope, scope));
}

// A connection that can't be refreshed.
//
// Distinct from every other Google failure because it's the only one the
// user can fix, and the only one where retrying is pointless. Google
// hands back `invalid_grant` when the refresh token has been revoked in
// the account's security settings, when the password changed, or — the
// common one during development — when the OAuth consent screen is still
// in Testing mode, where refresh tokens expire after seven days.
//
// Left as a generic 500, all three of those surface as "Failed to fetch
// messages from Gmail" with no next step. The whole point of this class
// is to carry "reconnect" all the way to the card.
export class GoogleAuthError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? "Your Google connection has expired.");
    this.name = "GoogleAuthError";
    this.reason = reason;
  }
}

// What Google says when the grant itself is dead, in the several shapes
// it says it: the token endpoint's OAuth error codes, and the API's own
// wording on a rejected credential.
const REAUTH_MARKERS = [
  "invalid_grant",
  "unauthorized_client",
  "invalid_client",
  "invalid_token",
  "token has been expired or revoked",
  "invalid credentials",
  "invalid authentication credentials",
];

/** Whether this failure means the user has to reconnect Google. */
export function isGoogleAuthFailure(err: unknown): boolean {
  if (err instanceof GoogleAuthError) return true;

  const { reason, detail } = googleErrorReason(err);
  const haystack = `${reason ?? ""} ${detail ?? ""}`.toLowerCase();
  if (REAUTH_MARKERS.some((marker) => haystack.includes(marker))) return true;

  const status =
    (err as { code?: number | string })?.code ??
    (err as { status?: number })?.status ??
    (err as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === "401";
}

/**
 * One failure, turned into what a route should answer with.
 *
 * `reauth_required` is the code every card keys off to offer a reconnect
 * link instead of a red box. Anything else keeps the caller's own
 * wording, because only the caller knows what was being attempted.
 */
export function googleFailureResponse(
  err: unknown,
  fallback: string
): { body: { error: string; code?: string }; status: number } {
  if (isGoogleAuthFailure(err)) {
    return {
      body: {
        error:
          "Your Google connection has expired — reconnect to restore access.",
        code: "reauth_required",
      },
      status: 401,
    };
  }
  return { body: { error: fallback }, status: 500 };
}

export function getOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env.local."
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Load the user's stored tokens and return an OAuth2 client already
// pointed at them. We force a refresh up front (rather than relying on
// the client's 'tokens' event) and await the Supabase write ourselves,
// so the persist finishes inside this request instead of racing a
// serverless function freeze after the response is sent.
export async function getAuthorizedClientForUser(
  userId: string
): Promise<OAuth2Client | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("google_tokens")
    .select("access_token, refresh_token, token_expiry, scope")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const client = getOAuthClient();
  client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? undefined,
    expiry_date: data.token_expiry
      ? new Date(data.token_expiry).getTime()
      : undefined,
    scope: data.scope ?? undefined,
  });

  // An access token expires in an hour; the refresh token is what keeps
  // the connection alive. Without one stored there is nothing to refresh
  // with, so an expired token is already the end of the road — say so
  // now rather than letting the first API call fail as a mystery 401.
  const expired =
    !data.token_expiry || new Date(data.token_expiry).getTime() <= Date.now();
  if (!data.refresh_token && expired) {
    throw new GoogleAuthError(
      "no_refresh_token",
      "Google didn't give Nexus a refresh token, so the connection " +
        "couldn't be renewed. Reconnecting fixes it."
    );
  }

  try {
    await client.getAccessToken();
  } catch (err) {
    // A dead grant is the user's to fix and no amount of retrying will
    // change it. Everything else — Google down, DNS, a timeout — is
    // ours, and stays an ordinary error so it isn't miscast as
    // "reconnect your account".
    if (isGoogleAuthFailure(err)) {
      const { reason, detail } = googleErrorReason(err);
      console.error(
        `Google token refresh failed for ${userId}: ${reason ?? "unknown"}` +
          (detail ? ` — ${detail}` : "")
      );
      throw new GoogleAuthError(reason ?? "invalid_grant");
    }
    throw err;
  }

  const credentials = client.credentials;

  // A refresh replaces `credentials` wholesale with the token response
  // (see refreshAccessTokenAsync in google-auth-library), and that
  // response doesn't always carry `scope`. When it doesn't, every
  // hasScope check downstream starts answering "no" — so a delete that
  // worked an hour ago starts claiming the account never granted
  // permission. The stored grant is the durable record; put it back.
  if (!credentials.scope && data.scope) {
    client.setCredentials({ ...credentials, scope: data.scope });
  }

  if (credentials.access_token && credentials.access_token !== data.access_token) {
    const update: Partial<GoogleTokenRow> = {
      updated_at: new Date().toISOString(),
      access_token: credentials.access_token,
    };
    if (credentials.refresh_token) update.refresh_token = credentials.refresh_token;
    if (credentials.expiry_date)
      update.token_expiry = new Date(credentials.expiry_date).toISOString();
    // Only ever widened from a real grant — never nulled out by a
    // response that happened to omit it.
    if (credentials.scope) update.scope = credentials.scope;
    await supabase.from("google_tokens").update(update).eq("user_id", userId);
  }

  return client;
}

// Why Google said no.
//
// A 403 from the Calendar API means several very different things, and
// they need different answers from the user:
//
//   - ACCESS_TOKEN_SCOPE_INSUFFICIENT / insufficientPermissions — the
//     token really doesn't carry the scope. Reconnecting fixes it.
//   - forbiddenForNonOrganizer — the scope is fine; this account is a
//     guest on someone else's event and Google won't let a guest delete
//     it. Reconnecting a hundred times changes nothing.
//   - readOnly / a calendar the account only subscribes to — same
//     story, different cause.
//
// Collapsing all of them into "reconnect Google" sends someone round a
// loop that cannot terminate: they reconnect, the grant is already
// complete, and the identical error comes back.
export type GoogleErrorReason = {
  // Google's machine-readable reason, when it gave one.
  reason: string | null;
  // Google's own human-readable message, when it gave one.
  detail: string | null;
  // Whether this specific 403 is actually about a missing scope.
  scopeRelated: boolean;
};

const SCOPE_REASONS = [
  "insufficientpermissions",
  "access_token_scope_insufficient",
  "forbidden_scope",
];

export function googleErrorReason(err: unknown): GoogleErrorReason {
  const e = err as {
    message?: string;
    errors?: { reason?: string; message?: string }[];
    response?: {
      data?: {
        error?:
          | string
          | { status?: string; message?: string; errors?: { reason?: string }[] };
        error_description?: string;
      };
    };
  };

  const data = e?.response?.data;
  const errorObj =
    data && typeof data.error === "object" ? data.error : undefined;

  const reason =
    e?.errors?.[0]?.reason ??
    errorObj?.errors?.[0]?.reason ??
    errorObj?.status ??
    (typeof data?.error === "string" ? data.error : null) ??
    null;

  const detail =
    e?.errors?.[0]?.message ??
    errorObj?.message ??
    data?.error_description ??
    e?.message ??
    null;

  const haystack = `${reason ?? ""} ${detail ?? ""}`.toLowerCase();
  const scopeRelated = SCOPE_REASONS.some((r) => haystack.includes(r));

  return { reason, detail, scopeRelated };
}
