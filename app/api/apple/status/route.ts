import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAppleConnection } from "@/lib/apple";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const connection = await getAppleConnection(userId);
    // The Apple ID comes back so the UI can show which account is
    // connected — useful for anyone with a personal and a family iCloud.
    return NextResponse.json({
      connected: Boolean(connection),
      appleId: connection?.appleId ?? null,
    });
  } catch (err) {
    console.error("Apple status check failed", errorMessage(err));
    return NextResponse.json(
      { error: "Failed to check Apple Calendar status" },
      { status: 500 }
    );
  }
}
