import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedClientForUser } from "@/lib/google";
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
    const status =
      typeof err === "object" && err && "code" in err && (err as { code: number }).code === 401
        ? 401
        : 500;
    return NextResponse.json(
      { error: "Failed to fetch messages from Gmail" },
      { status }
    );
  }
}
