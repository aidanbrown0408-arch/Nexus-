import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateBrief, type BriefResult } from "@/lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One generation per user at a time, within this instance.
//
// The cache only helps on a hit, and the one request a day that actually
// costs money is the miss — which React's development double-render, or
// two tabs opened together, turns into two full model calls. Concurrent
// callers now await the first one's promise instead of racing it.
//
// In-process only: a second serverless instance can still duplicate.
// Closing that needs a lock row, which is more machinery than the
// remaining case justifies.
const inFlight = new Map<string, Promise<BriefResult>>();

function toResponse(result: BriefResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status }
    );
  }
  return NextResponse.json({
    brief: result.brief,
    generatedAt: result.generatedAt,
    cached: result.cached,
  });
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  // Read and rewrite are keyed apart: a rewrite arriving while a read is
  // in flight should do its own work, not inherit the read's answer.
  const key = `${userId}:${forceRefresh ? "rewrite" : "read"}`;

  const existing = inFlight.get(key);
  if (existing) {
    console.log("[brief] joined a generation already in flight");
    return toResponse(await existing);
  }

  const work = generateBrief(userId, {
    forceRefresh,
    fallbackTimezone: request.nextUrl.searchParams.get("tz"),
  });
  inFlight.set(key, work);
  try {
    return toResponse(await work);
  } finally {
    inFlight.delete(key);
  }
}
