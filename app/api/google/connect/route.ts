import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { GOOGLE_SCOPES, getOAuthClient, OAUTH_STATE_COOKIE } from "@/lib/google";

export const runtime = "nodejs";

// Kicks off the Google OAuth consent flow.
//
// `state` used to be the Clerk user id. That tied the callback to a user,
// which is half of what state is for, but it is not a secret: a Clerk id
// is visible to the client and travels in plenty of places. An
// unguessable state is the other half, and the reason the parameter
// exists at all — without it, someone who knows a victim's user id can
// hand them a callback URL carrying the *attacker's* authorization code
// and quietly connect the attacker's Google account to the victim's
// Nexus account.
//
// So: a random nonce, kept in an httpOnly cookie that never leaves this
// origin, and compared against the returned state in the callback. The
// user id rides along in the cookie too, so a state minted for one
// signed-in user can't be redeemed by another.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nonce = randomBytes(32).toString("base64url");

  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    // Force the consent screen so Google actually returns a refresh_token
    // on repeat connects — without this, the second connect from the same
    // account can come back without one.
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state: nonce,
    include_granted_scopes: true,
  });

  const response = NextResponse.redirect(url);
  // Set on the response rather than through `cookies()`. The whole flow
  // depends on this cookie surviving the redirect, and writing it where
  // the response is built leaves no doubt that it does.
  response.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: `${nonce}:${userId}`,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Long enough to read a consent screen, short enough that a stale
    // one can't be replayed days later.
    maxAge: 10 * 60,
  });
  return response;
}
