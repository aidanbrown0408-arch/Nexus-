import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  googleFailureResponse,
} from "@/lib/google";
import { fetchRecentMessages } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MESSAGE_LIMIT = 20;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Gmail not connected", code: "not_connected" },
        { status: 400 }
      );
    }

    const messages = await fetchRecentMessages(client, MESSAGE_LIMIT);

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    console.error("Gmail messages fetch failed", err);
    // An expired grant comes back as `reauth_required` so the card can
    // offer the one thing that fixes it. Before this, a revoked refresh
    // token read as a plain server error and the only cure — reconnect —
    // was the one thing the UI never suggested.
    const { body, status } = googleFailureResponse(
      err,
      "Failed to fetch messages from Gmail"
    );
    return NextResponse.json(body, { status });
  }
}
