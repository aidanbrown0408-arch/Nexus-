import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  googleFailureResponse,
} from "@/lib/google";
import { fetchThread } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read one conversation in full.
//
// The inbox list carries a 100-character snippet, which is enough to
// decide whether a message matters and never enough to act on it. This is
// what the row expands into: the whole thread, oldest first, fetched on
// demand so opening the inbox stays one request instead of twenty.
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messageId = request.nextUrl.searchParams.get("messageId")?.trim();
  if (!messageId) {
    return NextResponse.json(
      { error: "messageId is required" },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Gmail not connected", code: "not_connected" },
        { status: 400 }
      );
    }

    const thread = await fetchThread(client, messageId, { full: true });
    return NextResponse.json({ thread });
  } catch (err: unknown) {
    console.error("Gmail thread fetch failed", err);
    const { body, status } = googleFailureResponse(
      err,
      "Couldn't open that email."
    );
    return NextResponse.json(body, { status });
  }
}
