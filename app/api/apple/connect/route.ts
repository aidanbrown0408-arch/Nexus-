import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  AppleAuthError,
  saveAppleCredentials,
  verifyAppleCredentials,
} from "@/lib/apple";
import { isEncryptionConfigured } from "@/lib/crypto";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apple's equivalent of /api/google/connect + /callback, collapsed into
// one route. There's no OAuth redirect to bounce through — the client
// posts an Apple ID and an app-specific password, and this either
// accepts them or explains why not.

type Body = {
  appleId?: unknown;
  appPassword?: unknown;
};

// Apple prints app-specific passwords as four groups of four letters,
// with the dashes. Users paste them with the dashes, without them, or
// with a stray space from the clipboard — normalize before validating so
// we don't reject a password that's actually correct.
function normalizePassword(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

function looksLikeAppPassword(value: string): boolean {
  const stripped = value.replace(/-/g, "");
  return /^[a-z]{16}$/.test(stripped);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEncryptionConfigured()) {
    console.error("Apple connect attempted without APPLE_ENCRYPTION_KEY set");
    return NextResponse.json(
      {
        error:
          "Apple Calendar isn't configured on the server yet. Set APPLE_ENCRYPTION_KEY.",
        code: "not_configured",
      },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const appleId =
    typeof body.appleId === "string" ? body.appleId.trim().toLowerCase() : "";
  const rawPassword =
    typeof body.appPassword === "string" ? body.appPassword : "";
  const appPassword = normalizePassword(rawPassword);

  if (!appleId || !appPassword) {
    return NextResponse.json(
      { error: "Both your Apple ID and an app-specific password are required." },
      { status: 400 }
    );
  }

  if (!appleId.includes("@")) {
    return NextResponse.json(
      { error: "That doesn't look like an Apple ID email address." },
      { status: 400 }
    );
  }

  // A regular Apple ID password will fail against CalDAV every time, and
  // the round-trip to iCloud takes seconds. Catching the shape here lets
  // us say what's actually wrong instead of "Apple rejected that".
  if (!looksLikeAppPassword(appPassword)) {
    return NextResponse.json(
      {
        error:
          "That looks like your regular Apple ID password. Nexus needs an " +
          "app-specific password (16 letters, like abcd-efgh-ijkl-mnop) " +
          "generated at appleid.apple.com.",
        code: "not_app_password",
      },
      { status: 400 }
    );
  }

  try {
    // Verify before storing. Saving credentials that don't work would
    // turn every later calendar fetch into a silent failure the user has
    // no way to connect back to this moment.
    const { calendarCount } = await verifyAppleCredentials({
      appleId,
      appPassword,
    });

    await saveAppleCredentials(userId, { appleId, appPassword });

    return NextResponse.json({ ok: true, appleId, calendarCount });
  } catch (err: unknown) {
    if (err instanceof AppleAuthError) {
      return NextResponse.json(
        { error: err.message, code: "invalid_credentials" },
        { status: 400 }
      );
    }
    console.error("Apple connect failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't reach iCloud just now. Try again in a moment." },
      { status: 502 }
    );
  }
}
