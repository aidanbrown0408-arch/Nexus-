import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("google_tokens")
      .delete()
      .eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Gmail disconnect failed", err);
    return NextResponse.json(
      { error: "Failed to disconnect Gmail" },
      { status: 500 }
    );
  }
}
