import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export type EmailSummary = {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  // Whether the message carries List-Unsubscribe. Only populated by the
  // inbox fetch that triage uses; the plain inbox list doesn't need it.
  bulk?: boolean;
};

function parseFromHeader(raw: string): { name: string; email: string } {
  // Header shapes: `Foo Bar <foo@bar.com>` or `foo@bar.com`.
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim() || match[2].trim(), email: match[2].trim() };
  }
  return { name: raw.trim(), email: raw.trim() };
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
};

function extractPlainText(payload: GmailPart | undefined | null): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts && payload.parts.length) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  // Fallback to HTML with tags stripped so we always show something.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

// Fetch the most recent messages for the account `client` is authorized
// against, newest first. Throws whatever the Gmail API throws; callers
// are responsible for turning that into a response.
export async function fetchRecentMessages(
  client: OAuth2Client,
  limit: number
): Promise<EmailSummary[]> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: limit,
  });

  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  if (!ids.length) return [];

  const details = await Promise.all(
    ids.map((id) =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      })
    )
  );

  const messages: EmailSummary[] = details.map((res) => {
    const m = res.data;
    const headers = m.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const fromRaw = getHeader("From");
    const { name: fromName, email: fromEmail } = parseFromHeader(fromRaw);

    const body = extractPlainText(m.payload as GmailPart) || m.snippet || "";
    const snippet = body.slice(0, 100);

    const dateHeader = getHeader("Date");
    const dateMs = m.internalDate ? Number(m.internalDate) : Date.parse(dateHeader);
    const date = Number.isFinite(dateMs)
      ? new Date(dateMs).toISOString()
      : new Date().toISOString();

    const unread = (m.labelIds ?? []).includes("UNREAD");

    return {
      id: m.id ?? "",
      threadId: m.threadId ?? "",
      from: fromName,
      fromEmail,
      subject: getHeader("Subject") || "(no subject)",
      snippet,
      date,
      unread,
    };
  });

  messages.sort((a, b) => (a.date < b.date ? 1 : -1));

  return messages;
}

// --- threads ------------------------------------------------------------

// One message inside a thread, with its body kept rather than truncated to
// a snippet. Replies are written against what was actually said, so this
// carries more than the inbox list needs.
export type ThreadMessage = {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  date: string;
  body: string;
};

export type EmailThread = {
  threadId: string;
  subject: string;
  messages: ThreadMessage[];
  // Headers from the newest message, needed to make a reply thread
  // correctly in every client rather than starting a parallel
  // conversation that merely shares a subject line.
  lastMessageId: string;
  lastRfcMessageId: string;
  lastReferences: string;
};

// How much of any single message body Claude is shown. Long quoted reply
// chains are mostly repetition of earlier messages we're already passing.
const MAX_BODY_CHARS = 4000;

// Strip the quoted copy of the previous message that clients append below
// a reply. Without this, a five-message thread hands the model the first
// message five times over.
function stripQuotedReply(body: string): string {
  const lines = body.split("\n");
  const cutoff = lines.findIndex((line) =>
    /^\s*(>|On .+ wrote:|-{2,}\s*Original Message|_{5,})/.test(line)
  );
  const kept = cutoff === -1 ? lines : lines.slice(0, cutoff);
  return kept.join("\n").trim();
}

// Fetch a whole thread, oldest message first. Callers pass a message id —
// Gmail resolves it to the thread that message belongs to.
export async function fetchThread(
  client: OAuth2Client,
  messageId: string
): Promise<EmailThread> {
  const gmail = google.gmail({ version: "v1", auth: client });

  const message = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "minimal",
  });
  const threadId = message.data.threadId;
  if (!threadId) throw new Error("Message has no thread");

  const res = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const raw = res.data.messages ?? [];
  if (!raw.length) throw new Error("Thread has no messages");

  const messages: ThreadMessage[] = raw.map((m) => {
    const headers = m.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const { name: fromName, email: fromEmail } = parseFromHeader(
      getHeader("From")
    );

    const body = extractPlainText(m.payload as GmailPart) || m.snippet || "";
    const dateMs = m.internalDate
      ? Number(m.internalDate)
      : Date.parse(getHeader("Date"));

    return {
      id: m.id ?? "",
      from: fromName,
      fromEmail,
      to: getHeader("To"),
      cc: getHeader("Cc"),
      date: Number.isFinite(dateMs)
        ? new Date(dateMs).toISOString()
        : new Date().toISOString(),
      body: stripQuotedReply(body).slice(0, MAX_BODY_CHARS),
    };
  });

  const lastRaw = raw[raw.length - 1];
  const lastHeaders = lastRaw.payload?.headers ?? [];
  const lastHeader = (name: string) =>
    lastHeaders.find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? "";

  const firstHeaders = raw[0].payload?.headers ?? [];
  const subject =
    firstHeaders.find((h) => h.name?.toLowerCase() === "subject")?.value ??
    "(no subject)";

  return {
    threadId,
    subject,
    messages,
    lastMessageId: lastRaw.id ?? "",
    lastRfcMessageId: lastHeader("Message-ID"),
    lastReferences: lastHeader("References"),
  };
}

// --- drafts -------------------------------------------------------------

export type CreatedDraft = {
  draftId: string;
  messageId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
};

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// RFC 5322 requires non-ASCII header values be encoded. Subjects carry
// names and em dashes often enough that skipping this mangles them.
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function replySubject(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`;
}

// Save a reply to the user's Gmail drafts. Nothing is sent — that's the
// point of this action, and why it needs no confirmation gate of its own.
//
// `threadId` on the draft is what makes Gmail file it under the existing
// conversation; In-Reply-To and References are what make every *other*
// mail client agree once it's sent.
export async function createReplyDraft(
  client: OAuth2Client,
  thread: EmailThread,
  to: string,
  body: string
): Promise<CreatedDraft> {
  const gmail = google.gmail({ version: "v1", auth: client });

  const subject = replySubject(thread.subject);
  const references = [thread.lastReferences, thread.lastRfcMessageId]
    .filter(Boolean)
    .join(" ");

  const headers = [
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
  ];
  if (thread.lastRfcMessageId) {
    headers.push(`In-Reply-To: ${thread.lastRfcMessageId}`);
  }
  if (references) headers.push(`References: ${references}`);

  const raw = encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${body}`);

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, threadId: thread.threadId } },
  });

  const draftId = res.data.id;
  if (!draftId) throw new Error("Gmail returned no draft id");

  return {
    draftId,
    messageId: res.data.message?.id ?? "",
    threadId: thread.threadId,
    to,
    subject,
    body,
  };
}

// Undo for a draft we created. Deleting a draft is safe in a way that
// deleting a message is not — nothing was sent, so nothing is lost but
// text the user never approved.
export async function deleteDraft(
  client: OAuth2Client,
  draftId: string
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.drafts.delete({ userId: "me", id: draftId });
}

// Who a reply should go to: whoever sent the newest message that wasn't
// the user. Replying to your own last message would address yourself.
export function replyRecipient(
  thread: EmailThread,
  selfEmail: string | null
): string {
  const self = selfEmail?.toLowerCase();
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (!self || message.fromEmail.toLowerCase() !== self) {
      return message.fromEmail;
    }
  }
  return thread.messages[thread.messages.length - 1].fromEmail;
}

// --- archive and label ---------------------------------------------------

// Archiving is removing the INBOX label. That's all it is in Gmail's
// model, which is why it's the gentlest write in this app: the message is
// untouched, still searchable, still in every thread it was in, and
// putting INBOX back is a complete reversal with nothing lost.
//
// This is deliberately the batchable action. Trashing gets a preview and
// a cap; archiving gets a checklist, because the worst case is a message
// the user has to search for instead of scroll to.

const MAX_BATCH = 100;

export async function archiveMessages(
  client: OAuth2Client,
  ids: string[]
): Promise<void> {
  if (!ids.length) return;
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: { ids: ids.slice(0, MAX_BATCH), removeLabelIds: ["INBOX"] },
  });
}

export async function unarchiveMessages(
  client: OAuth2Client,
  ids: string[]
): Promise<void> {
  if (!ids.length) return;
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: { ids: ids.slice(0, MAX_BATCH), addLabelIds: ["INBOX"] },
  });
}

export type GmailLabel = {
  id: string;
  name: string;
  // Gmail's own labels (INBOX, SPAM, CATEGORY_*) can't be renamed or
  // deleted and mostly shouldn't be offered as things to apply.
  system: boolean;
};

export async function listLabels(
  client: OAuth2Client
): Promise<GmailLabel[]> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.labels.list({ userId: "me" });

  return (res.data.labels ?? [])
    .filter((l) => l.id && l.name)
    .map((l) => ({
      id: l.id as string,
      name: l.name as string,
      system: l.type === "system",
    }))
    .filter((l) => !l.system)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Create a label, or hand back the existing one with that name. Gmail
// rejects a duplicate name with a 409, and "you already have that label"
// isn't a failure from the user's point of view — they asked for mail to
// end up under a name, and it will.
export async function ensureLabel(
  client: OAuth2Client,
  name: string
): Promise<GmailLabel> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const trimmed = name.trim();

  try {
    const res = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: trimmed,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    return {
      id: res.data.id as string,
      name: res.data.name as string,
      system: false,
    };
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code !== 409) throw err;

    const existing = await listLabels(client);
    const match = existing.find(
      (l) => l.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (!match) throw err;
    return match;
  }
}

export async function applyLabel(
  client: OAuth2Client,
  ids: string[],
  labelId: string
): Promise<void> {
  if (!ids.length) return;
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: { ids: ids.slice(0, MAX_BATCH), addLabelIds: [labelId] },
  });
}

export async function removeLabel(
  client: OAuth2Client,
  ids: string[],
  labelId: string
): Promise<void> {
  if (!ids.length) return;
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: { ids: ids.slice(0, MAX_BATCH), removeLabelIds: [labelId] },
  });
}

// Recent mail still sitting in the inbox. Triage only proposes things
// that are actually in front of the user — archiving something they
// already dealt with would be noise about noise.
export async function fetchInboxMessages(
  client: OAuth2Client,
  limit: number
): Promise<EmailSummary[]> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "in:inbox",
    maxResults: limit,
  });

  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  if (!ids.length) return [];

  const details = await Promise.all(
    ids.map((id) =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date", "List-Unsubscribe"],
      })
    )
  );

  return details.map((res) => {
    const m = res.data;
    const headers = m.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const { name: fromName, email: fromEmail } = parseFromHeader(
      getHeader("From")
    );
    const dateMs = m.internalDate
      ? Number(m.internalDate)
      : Date.parse(getHeader("Date"));

    return {
      id: m.id ?? "",
      threadId: m.threadId ?? "",
      from: fromName,
      fromEmail,
      subject: getHeader("Subject") || "(no subject)",
      snippet: m.snippet ?? "",
      date: Number.isFinite(dateMs)
        ? new Date(dateMs).toISOString()
        : new Date().toISOString(),
      unread: (m.labelIds ?? []).includes("UNREAD"),
      // The clearest machine-readable signal that something is a bulk
      // mailing rather than a person writing to you. Passed to the
      // classifier as evidence rather than used as a rule on its own —
      // plenty of mail people care about carries it.
      bulk: Boolean(getHeader("List-Unsubscribe")),
    };
  });
}

// The address Gmail considers "me" for this token, used to tell the
// user's own messages apart from everyone else's in a thread.
export async function fetchOwnEmail(
  client: OAuth2Client
): Promise<string | null> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.getProfile({ userId: "me" });
  return res.data.emailAddress ?? null;
}
