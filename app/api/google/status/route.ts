import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { GOOGLE_SCOPES, missingScopes } from "@/lib/google";

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
      .select("user_id, scope")
      .eq("user_id", userId)
      .maybeSingle<{ user_id: string; scope: string | null }>();
    if (error) throw error;

    // The granted scopes ride along so "connected" can be checked
    // against what the connection can actually do. Without this the
    // only way to find out a permission was never granted was to try
    // the thing it gates and read the failure.
    return NextResponse.json({
      connected: Boolean(data),
      granted: data?.scope ? data.scope.split(/\s+/).filter(Boolean) : [],
      missing: data ? missingScopes(data.scope) : GOOGLE_SCOPES,
    });
  } catch (err) {
    console.error("Gmail status check failed", err);
    return NextResponse.json(
      { error: "Failed to check Gmail status" },
      { status: 500 }
    );
  }
}
