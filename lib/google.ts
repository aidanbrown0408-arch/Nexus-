import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getSupabaseAdmin, type GoogleTokenRow } from "./supabase";

// Every Google scope the app asks for at connect time. Gmail-only for
// now; Calendar and friends get appended here rather than in a
// per-API list.
export const GOOGLE_SCOPES = [
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
