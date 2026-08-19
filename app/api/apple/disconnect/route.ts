import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteAppleCredentials } from "@/lib/apple";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteAppleCredentials(userId);
    // Deleting our copy doesn't invalidate the password on Apple's side —
    // the UI tells the user to revoke it at appleid.apple.com if they
    // want it gone for good.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Apple disconnect failed", errorMessage(err));
    return NextResponse.json(
      { error: "Failed to disconnect Apple Calendar" },
      { status: 500 }
    );
  }
}
