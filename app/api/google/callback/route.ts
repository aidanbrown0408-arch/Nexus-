import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOAuthClient } from "@/lib/google";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function dashboardUrl(req: NextRequest, params: Record<string, string> = {}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const url = new URL("/dashboard", base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(dashboardUrl(req, { google: "unauthorized" }));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(dashboardUrl(req, { google: "denied" }));
  }
  if (!code || state !== userId) {
    return NextResponse.redirect(dashboardUrl(req, { google: "error" }));
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("google_tokens").upsert(
      {
        user_id: userId,
        access_token: tokens.access_token ?? "",
        refresh_token: tokens.refresh_token ?? null,
        token_expiry: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        scope: tokens.scope ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) throw error;

    return NextResponse.redirect(dashboardUrl(req, { google: "connected" }));
  } catch (err) {
    console.error("Gmail OAuth callback failed", err);
    return NextResponse.redirect(dashboardUrl(req, { google: "error" }));
  }
}
