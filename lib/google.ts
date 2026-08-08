import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getSupabaseAdmin, type GmailTokenRow } from "./supabase";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

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
// pointed at them. The googleapis library refreshes the access token on
// its own when needed; we listen for that and persist the new one so we
// don't burn the refresh token on every call.
export async function getAuthorizedClientForUser(
  userId: string
): Promise<OAuth2Client | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("gmail_tokens")
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

  client.on("tokens", async (tokens) => {
    const update: Partial<GmailTokenRow> = {
      updated_at: new Date().toISOString(),
    };
    if (tokens.access_token) update.access_token = tokens.access_token;
    if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;
    if (tokens.expiry_date)
      update.token_expiry = new Date(tokens.expiry_date).toISOString();
    if (tokens.scope) update.scope = tokens.scope;
    await supabase.from("gmail_tokens").update(update).eq("user_id", userId);
  });

  return client;
}
