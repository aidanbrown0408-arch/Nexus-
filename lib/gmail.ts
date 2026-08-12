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
