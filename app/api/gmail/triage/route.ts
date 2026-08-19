import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  GMAIL_MODIFY_SCOPE,
} from "@/lib/google";
import { fetchInboxMessages, listLabels } from "@/lib/gmail";
import { proposeArchive } from "@/lib/triage";
import { getProfile, type UserProfileRow } from "@/lib/profile";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How much inbox to look at in one pass. Big enough that the result feels
// worth the click, small enough that the model sees each message properly
// rather than skimming two hundred.
const SCAN_LIMIT = 40;

// Propose what to archive. Writes nothing.
//
// The scope check runs here even though this route only reads, so the
// user finds out they need to reconnect before spending a model call and
// picking through a list they can't act on.
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
    if (!hasScope(client.credentials.scope, GMAIL_MODIFY_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to archive and label your mail.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    const messages = await fetchInboxMessages(client, SCAN_LIMIT);
    if (!messages.length) {
      return NextResponse.json({ proposals: [], labels: [], scanned: 0 });
    }

    // Who the user said matters and what they said is noise. Loaded
    // before the model call rather than alongside it because triage
    // without the profile is the version that proposes archiving a
    // co-founder — better to spend a round trip than to get that wrong.
    let profile: UserProfileRow | null = null;
    try {
      profile = await getProfile(userId);
    } catch (err) {
      console.error("Triage: profile unavailable", errorMessage(err));
    }

    // Labels ride along so the "also label these" dropdown is populated
    // by the time the user has read the list, rather than after.
    const [result, labels] = await Promise.all([
      proposeArchive(messages, profile),
      listLabels(client).catch(() => []),
    ]);

    return NextResponse.json({
      proposals: result.proposals,
      vipProtected: result.vipProtected,
      labels,
      scanned: messages.length,
    });
  } catch (err) {
    console.error("Triage failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't scan your inbox just now.", code: "triage_failed" },
      { status: 503 }
    );
  }
}
