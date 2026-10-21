import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteAccount } from "@/lib/account";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delete the signed-in user's account and every row Nexus holds for them.
// The body has to carry the literal confirmation the settings page asks
// for, so a stray request (or a CSRF attempt riding a session cookie)
// can't do something this permanent on its own.
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { confirm?: unknown }
    | null;
  if (body?.confirm !== "DELETE") {
    return NextResponse.json(
      { error: "Type DELETE to confirm." },
      { status: 400 }
    );
  }

  try {
    await deleteAccount(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[account] delete failed for ${userId}`, errorMessage(err));
    return NextResponse.json(
      {
        error:
          "Something went wrong deleting your account. Nothing was left half-done that you can't retry — please try again.",
      },
      { status: 500 }
    );
  }
}
