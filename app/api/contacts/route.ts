import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  CONTACTS_SCOPE,
} from "@/lib/google";
import { searchContacts, warmContactCache } from "@/lib/contacts";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Look people up for the guest picker.
//
// Every failure here returns an empty list rather than an error, and
// that's deliberate: the guest field still accepts a typed address, so
// "no suggestions" degrades to exactly the behaviour this replaced. A red
// banner over an autocomplete would be noise about a feature that's
// working fine without it.
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  // `warm` is sent once when the guest field is first focused. Google's
  // contact indexes start cold and the first real search returns nothing
  // otherwise — see warmContactCache.
  const warm = url.searchParams.get("warm") === "true";

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json({ contacts: [], code: "not_connected" });
    }
    // Anyone who connected before contacts were added has a token that
    // can't read them. The picker just stays quiet.
    if (!hasScope(client.credentials.scope, CONTACTS_SCOPE)) {
      return NextResponse.json({ contacts: [], code: "scope_missing" });
    }

    if (warm) {
      await warmContactCache(client);
      return NextResponse.json({ contacts: [] });
    }

    const contacts = await searchContacts(client, query);
    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("Contact search failed", errorMessage(err));
    return NextResponse.json({ contacts: [] });
  }
}
