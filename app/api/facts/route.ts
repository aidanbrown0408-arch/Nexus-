import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listFacts, liveFacts } from "@/lib/memory";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everything Nexus has inferred about the signed-in user.
//
// Expired facts are filtered out rather than shown greyed: the page's
// promise is "this is what Nexus is working from", and something it has
// stopped using doesn't belong in that answer. The prune in the brief
// eventually deletes them for real.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const facts = liveFacts(await listFacts(userId));
    return NextResponse.json({ facts });
  } catch (err) {
    console.error("Facts read failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't load what Nexus remembers." },
      { status: 500 }
    );
  }
}
