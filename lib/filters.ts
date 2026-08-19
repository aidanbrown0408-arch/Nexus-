import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// Filters that send mail straight to Trash.
//
// This is the first thing Nexus sets up that then runs *without it* —
// Google applies the filter to incoming mail whether or not this app is
// running. That's a real departure from every other action here, and two
// rules follow from it:
//
//   - Nothing is ever permanently deleted. Filters add the TRASH label,
//     which Gmail keeps for 30 days and the user can undo by hand. We do
//     not ask for gmail.delete and there is no code path that bypasses
//     Trash.
//   - No filter is created without the user first seeing what it catches.
//     A filter that runs unsupervised has to earn that with an explicit
//     preview against real mail, not a description of what it should do.
//
// Gmail filters only apply to mail that arrives *after* they're created.
// Clearing what's already in the inbox is a separate, separately-approved
// sweep — see trashMatching().

export type FilterCriteria = {
  from?: string;
  to?: string;
  subject?: string;
  // Raw Gmail search syntax, for anything the structured fields can't say
  // (`older_than:1y`, `has:attachment`, `list:...`).
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
};

export type GmailFilter = {
  id: string;
  criteria: FilterCriteria;
  // What the filter does. Nexus only creates trashing filters today, but
  // a user's existing filters do other things and shouldn't be
  // misreported as deleting mail.
  trashes: boolean;
  addLabelIds: string[];
  removeLabelIds: string[];
};

// Never widen this. A preview is a read, and a read that could quietly
// scan an entire mailbox is worse than one that shows a bounded sample.
const PREVIEW_LIMIT = 25;
// Batch cap for a backlog sweep. Gmail's own limit is 1000 per call; the
// lower number here is so an over-broad filter can't empty an inbox in a
// single click before anyone notices.
const SWEEP_LIMIT = 200;

// Turn criteria into the Gmail search string that finds the same mail.
// Used for the preview and the backlog sweep, so both are guaranteed to
// be looking at exactly what the filter will act on — a preview built
// from different logic than the filter is worse than no preview.
export function criteriaToQuery(criteria: FilterCriteria): string {
  const parts: string[] = [];
  const quote = (value: string) =>
    /[\s:]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;

  if (criteria.from) parts.push(`from:${quote(criteria.from)}`);
  if (criteria.to) parts.push(`to:${quote(criteria.to)}`);
  if (criteria.subject) parts.push(`subject:${quote(criteria.subject)}`);
  if (criteria.hasAttachment) parts.push("has:attachment");
  if (criteria.query) parts.push(criteria.query);
  if (criteria.negatedQuery) parts.push(`-(${criteria.negatedQuery})`);

  return parts.join(" ");
}

// A criteria set that matches nothing is a UI bug; one that matches
// everything is a disaster. Both are caught here rather than at Google.
export function criteriaAreUsable(criteria: FilterCriteria): boolean {
  return Boolean(
    criteria.from?.trim() ||
      criteria.to?.trim() ||
      criteria.subject?.trim() ||
      criteria.query?.trim() ||
      criteria.hasAttachment
  );
}

export type PreviewMessage = {
  id: string;
  from: string;
  subject: string;
  date: string;
};

export type FilterPreview = {
  query: string;
  // Gmail's own estimate across the whole mailbox, not just the sample.
  // The gap between this and `messages.length` is the point: "23 shown,
  // 1,400 matched" is the number that should give someone pause.
  totalEstimate: number;
  messages: PreviewMessage[];
};

// What this filter would have caught in mail already received. The only
// honest way to show someone what a rule does before it starts running
// unsupervised.
export async function previewFilter(
  client: OAuth2Client,
  criteria: FilterCriteria
): Promise<FilterPreview> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const query = criteriaToQuery(criteria);

  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: PREVIEW_LIMIT,
  });

  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);

  const details = await Promise.all(
    ids.map((id) =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      })
    )
  );

  const messages: PreviewMessage[] = details.map((res) => {
    const headers = res.data.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const dateMs = res.data.internalDate
      ? Number(res.data.internalDate)
      : Date.parse(getHeader("Date"));

    return {
      id: res.data.id ?? "",
      from: getHeader("From"),
      subject: getHeader("Subject") || "(no subject)",
      date: Number.isFinite(dateMs)
        ? new Date(dateMs).toISOString()
        : new Date().toISOString(),
    };
  });

  return {
    query,
    totalEstimate: list.data.resultSizeEstimate ?? messages.length,
    messages,
  };
}

// --- the filters themselves ---------------------------------------------

function toGmailFilter(raw: {
  id?: string | null;
  criteria?: {
    from?: string | null;
    to?: string | null;
    subject?: string | null;
    query?: string | null;
    negatedQuery?: string | null;
    hasAttachment?: boolean | null;
  } | null;
  action?: {
    addLabelIds?: string[] | null;
    removeLabelIds?: string[] | null;
  } | null;
}): GmailFilter {
  const addLabelIds = raw.action?.addLabelIds ?? [];
  return {
    id: raw.id ?? "",
    criteria: {
      from: raw.criteria?.from ?? undefined,
      to: raw.criteria?.to ?? undefined,
      subject: raw.criteria?.subject ?? undefined,
      query: raw.criteria?.query ?? undefined,
      negatedQuery: raw.criteria?.negatedQuery ?? undefined,
      hasAttachment: raw.criteria?.hasAttachment ?? undefined,
    },
    trashes: addLabelIds.includes("TRASH"),
    addLabelIds,
    removeLabelIds: raw.action?.removeLabelIds ?? [],
  };
}

export async function listFilters(
  client: OAuth2Client
): Promise<GmailFilter[]> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.settings.filters.list({ userId: "me" });
  return (res.data.filter ?? []).map(toGmailFilter);
}

// Create a filter that trashes matching incoming mail.
//
// TRASH rather than a permanent delete is deliberate and load-bearing:
// it's what makes an over-broad filter a recoverable mistake instead of a
// permanent one. Gmail holds trashed mail for 30 days.
export async function createTrashFilter(
  client: OAuth2Client,
  criteria: FilterCriteria
): Promise<GmailFilter> {
  if (!criteriaAreUsable(criteria)) {
    throw new Error("Refusing to create a filter that matches everything");
  }

  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.settings.filters.create({
    userId: "me",
    requestBody: {
      criteria: {
        from: criteria.from || undefined,
        to: criteria.to || undefined,
        subject: criteria.subject || undefined,
        query: criteria.query || undefined,
        negatedQuery: criteria.negatedQuery || undefined,
        hasAttachment: criteria.hasAttachment || undefined,
      },
      action: { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] },
    },
  });

  return toGmailFilter(res.data);
}

// Removing a filter stops it acting on future mail. It does not bring
// back anything already trashed — that's a separate undo, and the action
// log records the sweep separately for exactly this reason.
export async function deleteFilter(
  client: OAuth2Client,
  filterId: string
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.settings.filters.delete({ userId: "me", id: filterId });
}

// --- backlog sweep -------------------------------------------------------

// Apply the same criteria to mail already in the mailbox.
//
// Separate from filter creation on purpose. A new filter only touches
// what arrives next; clearing the existing pile is a bigger, more
// surprising action, so it gets its own approval and its own log entry
// with the ids needed to reverse it.
export async function trashMatching(
  client: OAuth2Client,
  criteria: FilterCriteria
): Promise<string[]> {
  if (!criteriaAreUsable(criteria)) {
    throw new Error("Refusing to sweep on criteria that match everything");
  }

  const gmail = google.gmail({ version: "v1", auth: client });
  const list = await gmail.users.messages.list({
    userId: "me",
    q: criteriaToQuery(criteria),
    maxResults: SWEEP_LIMIT,
  });

  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  if (!ids.length) return [];

  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids,
      addLabelIds: ["TRASH"],
      removeLabelIds: ["INBOX"],
    },
  });

  return ids;
}

// Put a sweep back. The ids come from the action log, so this restores
// exactly what Nexus moved and nothing that was already in Trash.
export async function untrashMessages(
  client: OAuth2Client,
  ids: string[]
): Promise<void> {
  if (!ids.length) return;
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids,
      addLabelIds: ["INBOX"],
      removeLabelIds: ["TRASH"],
    },
  });
}

// Short human description of what a filter catches, for the log and the
// list. Reads as a sentence rather than as query syntax.
export function describeCriteria(criteria: FilterCriteria): string {
  const parts: string[] = [];
  if (criteria.from) parts.push(`from ${criteria.from}`);
  if (criteria.to) parts.push(`to ${criteria.to}`);
  if (criteria.subject) parts.push(`subject containing "${criteria.subject}"`);
  if (criteria.hasAttachment) parts.push("with an attachment");
  if (criteria.query) parts.push(`matching ${criteria.query}`);
  if (criteria.negatedQuery) parts.push(`except ${criteria.negatedQuery}`);
  return parts.join(", ") || "everything";
}
