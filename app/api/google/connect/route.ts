import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GOOGLE_SCOPES, getOAuthClient } from "@/lib/google";

export const runtime = "nodejs";

// Kicks off the Google OAuth consent flow. We stash the Clerk user id in
// the `state` param so the callback can associate the returned tokens
// with the right user without trusting anything else round-trip.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    // Force the consent screen so Google actually returns a refresh_token
    // on repeat connects — without this, the second connect from the same
    // account can come back without one.
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state: userId,
    include_granted_scopes: true,
  });

  return NextResponse.redirect(url);
}
