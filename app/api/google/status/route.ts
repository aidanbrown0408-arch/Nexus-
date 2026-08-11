import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("google_tokens")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ connected: Boolean(data) });
  } catch (err) {
    console.error("Gmail status check failed", err);
    return NextResponse.json(
      { error: "Failed to check Gmail status" },
      { status: 500 }
    );
  }
}
