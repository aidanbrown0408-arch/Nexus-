import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  GMAIL_MODIFY_SCOPE,
  GMAIL_SETTINGS_SCOPE,
} from "@/lib/google";
import {
  createTrashFilter,
  criteriaAreUsable,
  describeCriteria,
  listFilters,
  trashMatching,
  type FilterCriteria,
} from "@/lib/filters";
import { rejectDangerousCriteria } from "@/lib/filter-parse";
import { actionTarget, logAction } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Note on the preview: this route re-validates criteria but cannot prove
// a preview was ever shown — the client sends criteria from its own
// state, and there is no token binding the two. That was worth naming
// rather than implying otherwise, because the safety here comes from
// `criteriaAreUsable` requiring a sender, recipient or subject anchor and
// from `rejectDangerousCriteria`, not from the preview having run.
//
// The user's filters. Nexus's own and Gmail's alike — a rule the user
// wrote in Gmail years ago is still deleting their mail, and hiding it
// here would make this list a worse answer to "what's eating my inbox"
// than Gmail's own settings page.
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
    if (!hasScope(client.credentials.scope, GMAIL_SETTINGS_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to manage your Gmail filters.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    const filters = await listFilters(client);
    return NextResponse.json({ filters });
  } catch (err) {
    console.error("Filter list failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't load your filters." },
      { status: 503 }
    );
  }
}

// Create a trashing filter, and optionally clear the matching backlog.
//
// These are two actions, logged separately, because they have different
// blast radii and different undos. Removing the filter stops future mail
// being trashed; it does not bring back what the sweep already moved.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let criteria: FilterCriteria;
  let label: string;
  let sweepExisting = false;
  try {
    const body = (await request.json()) as {
      criteria?: unknown;
      label?: unknown;
      sweepExisting?: unknown;
    };
    if (!body.criteria || typeof body.criteria !== "object") {
      return NextResponse.json(
        { error: "criteria is required" },
        { status: 400 }
      );
    }
    criteria = body.criteria as FilterCriteria;
    label = typeof body.label === "string" ? body.label.trim() : "Untitled rule";
    sweepExisting = body.sweepExisting === true;
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  if (!criteriaAreUsable(criteria)) {
    return NextResponse.json(
      { error: "Those criteria would match everything.", code: "too_broad" },
      { status: 422 }
    );
  }
  // Re-checked here even though preview already did. This is the route
  // that actually creates the thing, so it can't rely on a client having
  // been through the preview honestly.
  const danger = rejectDangerousCriteria(criteria);
  if (danger) {
    return NextResponse.json({ error: danger, code: "too_broad" }, { status: 422 });
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
    if (sweepExisting && !hasScope(client.credentials.scope, GMAIL_MODIFY_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to move existing mail to Trash.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    const filter = await createTrashFilter(client, criteria);
    const description = describeCriteria(criteria);

    const filterAction = await logAction(userId, {
      kind: "filter",
      summary: `Created a rule sending new mail ${description} to Trash — "${label}"`,
      target: { filterId: filter.id },
      undo: "remove_filter",
    });

    // The sweep is its own action with its own log row carrying the ids
    // it moved. Undoing it restores exactly those messages rather than
    // everything currently sitting in Trash.
    let swept: string[] = [];
    let sweepActionId: string | null = null;
    let sweepRemaining = 0;

    if (sweepExisting) {
      const result = await trashMatching(client, criteria);
      swept = result.ids;
      // What's left behind after one page. Reported so the log entry and
      // the card can both say "200 of about 1,400" — a user told the
      // backlog is cleared when 1,200 remain will find out the hard way.
      sweepRemaining = result.truncated
        ? Math.max(0, result.totalMatched - swept.length)
        : 0;

      if (swept.length) {
        const sweepAction = await logAction(userId, {
          kind: "trash",
          summary:
            `Moved ${swept.length} existing message${
              swept.length === 1 ? "" : "s"
            } ${description} to Trash` +
            (sweepRemaining
              ? ` (about ${sweepRemaining} more still match)`
              : ""),
          target: actionTarget.messages(swept),
          undo: "untrash",
        });
        sweepActionId = sweepAction?.id ?? null;
      }
    }

    return NextResponse.json({
      filter,
      label,
      sweptCount: swept.length,
      sweepRemaining,
      actionId: filterAction?.id ?? null,
      sweepActionId,
    });
  } catch (err) {
    console.error("Filter create failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't create that rule.", code: "create_failed" },
      { status: 503 }
    );
  }
}
