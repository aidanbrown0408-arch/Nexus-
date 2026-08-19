import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedClientForUser, hasScope, GMAIL_SETTINGS_SCOPE } from "@/lib/google";
import { criteriaAreUsable, previewFilter, type FilterCriteria } from "@/lib/filters";
import {
  MAX_DESCRIPTION_LENGTH,
  parseFilterDescription,
  rejectDangerousCriteria,
} from "@/lib/filter-parse";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Work out what a rule would catch, without creating anything.
//
// This route is the safety mechanism for the whole feature, so it is
// deliberately the only way to reach filter creation: the client can't
// name criteria the user hasn't seen the consequences of. Nothing here
// writes to the account or the log — a preview isn't an action.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let description: string | undefined;
  let criteria: FilterCriteria | undefined;
  try {
    const body = (await request.json()) as {
      description?: unknown;
      criteria?: unknown;
    };
    if (typeof body.description === "string" && body.description.trim()) {
      description = body.description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
    }
    // An edited preview comes back as criteria rather than prose — the
    // user narrowing what Claude proposed shouldn't have to survive a
    // second round of interpretation.
    if (body.criteria && typeof body.criteria === "object") {
      criteria = body.criteria as FilterCriteria;
    }
    if (!description && !criteria) {
      return NextResponse.json(
        { error: "Describe what you want filtered." },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Gmail not connected", code: "not_connected" },
        { status: 400 }
      );
    }
    if (!hasScope(client.credentials.scope, GMAIL_SETTINGS_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to manage your Gmail filters.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    let label = "Untitled rule";
    let concern: string | null = null;

    if (!criteria && description) {
      const parsed = await parseFilterDescription(description);
      criteria = parsed.criteria;
      label = parsed.label;
      concern = parsed.concern;
    }

    if (!criteria || !criteriaAreUsable(criteria)) {
      return NextResponse.json(
        {
          error:
            "That's too vague to turn into a rule. Name a sender or a subject.",
          code: "too_broad",
        },
        { status: 422 }
      );
    }

    // Checked on every preview, including edited criteria — the guard
    // has to sit in front of the thing that creates filters, not just in
    // front of the model.
    const danger = rejectDangerousCriteria(criteria);
    if (danger) {
      return NextResponse.json(
        { error: danger, code: "too_broad" },
        { status: 422 }
      );
    }

    const preview = await previewFilter(client, criteria);

    return NextResponse.json({ criteria, label, concern, preview });
  } catch (err) {
    console.error("Filter preview failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't work out what that would catch.", code: "preview_failed" },
      { status: 503 }
    );
  }
}
