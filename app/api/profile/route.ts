import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getProfile,
  saveAnswers,
  sanitizeAnswers,
  markOnboardingSeen,
} from "@/lib/profile";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read the current profile — used by the settings view to pre-fill, and by
// the wizard to resume where someone left off.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profile = await getProfile(userId);
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("Profile read failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't load your profile." },
      { status: 500 }
    );
  }
}

// Save answers. The wizard PATCHes after each question rather than once at
// the end — someone who closes the tab at question five keeps the four
// they already gave.
//
// `finish` and `skip` are the two ways out of the interview. Both write a
// row, which is what stops the dashboard sending them back in; only
// `finish` sets completed_at.
export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { answers, finish, skip } = body as {
    answers?: Record<string, unknown>;
    finish?: boolean;
    skip?: boolean;
  };

  try {
    if (answers && typeof answers === "object") {
      const patch = sanitizeAnswers(answers);
      // An all-unknown-fields payload still needs to create the row when
      // it arrives with skip/finish, but on its own it's a no-op rather
      // than a pointless write.
      if (Object.keys(patch).length) {
        await saveAnswers(userId, patch);
      }
    }

    if (finish || skip) {
      await markOnboardingSeen(userId, Boolean(finish));
    }

    const profile = await getProfile(userId);
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("Profile write failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't save that just now." },
      { status: 500 }
    );
  }
}
