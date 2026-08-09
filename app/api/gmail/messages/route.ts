import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await clerkClient();
    const tokenResponse = await client.users.getUserOauthAccessToken(
      userId,
      "oauth_google",
    );
    const accessToken = tokenResponse.data?.[0]?.token;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Google account not connected. Sign in with Google to view your inbox." },
        { status: 403 },
      );
    }

    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );

    if (!listRes.ok) {
      const body = await listRes.text();
      console.error("Gmail list error:", listRes.status, body);
      return NextResponse.json(
        { error: "Gmail API error. Make sure the Gmail API is enabled and the gmail.readonly scope is configured in Clerk." },
        { status: listRes.status },
      );
    }

    const listData = await listRes.json();
    const messageIds: { id: string }[] = listData.messages ?? [];

    if (messageIds.length === 0) {
      return NextResponse.json({ messages: [] });
    }

    const details = await Promise.all(
      messageIds.map(async ({ id }) => {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          },
        );
        if (!res.ok) return null;
        return res.json();
      }),
    );

    const messages = details
      .filter(Boolean)
      .map((msg: Record<string, unknown>) => {
        const payload = msg.payload as
          | { headers?: { name: string; value: string }[] }
          | undefined;
        const headers = payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
            ?.value ?? "";
        return {
          id: msg.id as string,
          subject: header("Subject"),
          from: header("From"),
          date: header("Date"),
          snippet: (msg.snippet as string) ?? "",
        };
      });

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("Gmail route error:", err);
    return NextResponse.json(
      { error: "Failed to connect to Gmail." },
      { status: 500 },
    );
  }
}
