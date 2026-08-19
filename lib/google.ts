import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getSupabaseAdmin, type GoogleTokenRow } from "./supabase";

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

  await client.getAccessToken();
  const credentials = client.credentials;

  if (credentials.access_token && credentials.access_token !== data.access_token) {
    const update: Partial<GoogleTokenRow> = {
      updated_at: new Date().toISOString(),
      access_token: credentials.access_token,
    };
    if (credentials.refresh_token) update.refresh_token = credentials.refresh_token;
    if (credentials.expiry_date)
      update.token_expiry = new Date(credentials.expiry_date).toISOString();
    if (credentials.scope) update.scope = credentials.scope;
    await supabase.from("google_tokens").update(update).eq("user_id", userId);
  }

  return client;
}
