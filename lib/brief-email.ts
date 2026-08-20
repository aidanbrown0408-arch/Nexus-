import type { Brief } from "./brief";
import type { Email } from "./mailer";

// The brief, as an email.
//
// Email is not a browser: no external stylesheet, no flexbox worth
// trusting, no JavaScript. Everything here is inline styles on tables and
// paragraphs, which is ugly to write and the only thing that renders the
// same in Gmail, Outlook and Mail.
//
// The plain-text part is not an afterthought. It's what a watch shows,
// what a screen reader prefers, and a large part of why a message lands
// in an inbox rather than a spam folder.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Headline URLs come from third-party RSS. Escaping stops the attribute
// being broken out of; this stops the link being a `javascript:` or
// `data:` payload in the first place.
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SOURCE_LABEL: Record<string, string> = {
  email: "Email",
  calendar: "Calendar",
  both: "Email + Calendar",
};

function moveMarker(percent: number): string {
  if (percent > 0) return "▲";
  if (percent < 0) return "▼";
  return "–";
}

// Colour is reinforcement, never the signal — the arrow and the sign
// carry direction, because red and green are exactly the pair a
// colourblind reader can't separate and email has no better affordance.
function moveColor(percent: number): string {
  if (percent > 0) return "#047857";
  if (percent < 0) return "#be123c";
  return "#737373";
}

export function renderBriefEmail(brief: Brief, to: string): Email {
  const html: string[] = [];
  const text: string[] = [];

  html.push(
    `<div style="margin:0;padding:24px 0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;">`,
    `<tr><td style="padding:28px 28px 8px 28px;">`,
    `<p style="margin:0 0 4px 0;font-size:18px;font-weight:600;color:#171717;">${escapeHtml(brief.greeting)}</p>`,
    `<p style="margin:0;font-size:15px;line-height:1.55;color:#404040;">${escapeHtml(brief.headline)}</p>`,
    `</td></tr>`
  );
  text.push(brief.greeting, "", brief.headline, "");

  if (brief.calendarUnavailable) {
    html.push(
      `<tr><td style="padding:12px 28px 0 28px;">`,
      `<p style="margin:0;padding:10px 12px;background:#fffbeb;border-radius:8px;font-size:13px;color:#92400e;">Based on your email only — your calendar wasn't available this morning.</p>`,
      `</td></tr>`
    );
    text.push("(Based on your email only — your calendar wasn't available.)", "");
  }

  if (brief.priorities.length) {
    html.push(`<tr><td style="padding:20px 28px 0 28px;">`);
    for (const priority of brief.priorities) {
      html.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #f5f5f5;">`,
        `<tr><td style="padding:14px 0;">`,
        `<p style="margin:0 0 2px 0;font-size:15px;font-weight:600;color:#171717;">${escapeHtml(priority.title)}`,
        `<span style="font-weight:400;font-size:12px;color:#a3a3a3;"> · ${escapeHtml(SOURCE_LABEL[priority.source] ?? priority.source)}</span></p>`,
        `<p style="margin:0;font-size:14px;line-height:1.55;color:#525252;">${escapeHtml(priority.reason)}</p>`,
        `</td></tr></table>`
      );
      text.push(`- ${priority.title} (${SOURCE_LABEL[priority.source] ?? priority.source})`, `  ${priority.reason}`);
    }
    html.push(`</td></tr>`);
    text.push("");
  }

  if (brief.scheduleNote) {
    html.push(
      `<tr><td style="padding:6px 28px 0 28px;">`,
      `<p style="margin:0;padding-top:12px;border-top:1px solid #f5f5f5;font-size:13px;color:#737373;">${escapeHtml(brief.scheduleNote)}</p>`,
      `</td></tr>`
    );
    text.push(brief.scheduleNote, "");
  }

  if (brief.markets?.quotes.length) {
    html.push(
      `<tr><td style="padding:20px 28px 0 28px;">`,
      `<p style="margin:0 0 8px 0;padding-top:14px;border-top:1px solid #f5f5f5;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#a3a3a3;">Markets</p>`,
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">`
    );
    text.push("MARKETS");
    // Two per row: a seven-wide row of numbers is unreadable on a phone,
    // and email has no wrapping flexbox to fall back on.
    for (let i = 0; i < brief.markets.quotes.length; i += 2) {
      html.push(`<tr>`);
      const pair = brief.markets.quotes.slice(i, i + 2);
      for (const quote of pair) {
        const price =
          quote.price >= 1000
            ? Math.round(quote.price).toLocaleString("en-US")
            : quote.price.toFixed(2);
        html.push(
          `<td width="50%" style="padding:6px 0;vertical-align:top;">`,
          `<span style="font-size:12px;color:#a3a3a3;">${escapeHtml(quote.label)}</span><br/>`,
          `<span style="font-size:14px;font-weight:600;color:#262626;">$${price}</span> `,
          `<span style="font-size:13px;font-weight:600;color:${moveColor(quote.changePercent)};">${moveMarker(quote.changePercent)} ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%</span>`,
          `</td>`
        );
        text.push(`  ${quote.label}: $${price} ${moveMarker(quote.changePercent)} ${quote.changePercent.toFixed(2)}%`);
      }
      // Seven quotes means a final row of one. Without a filler cell
      // Gmail and Outlook stretch it across the full width and it stops
      // lining up with the column above.
      if (pair.length === 1) html.push(`<td width="50%"></td>`);
      html.push(`</tr>`);
    }
    html.push(`</table></td></tr>`);
    text.push("");
  }

  if (brief.situation) {
    html.push(`<tr><td style="padding:18px 28px 0 28px;">`);
    html.push(
      `<p style="margin:0 0 8px 0;padding-top:14px;border-top:1px solid #f5f5f5;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#a3a3a3;">What's going on</p>`
    );
    text.push("WHAT'S GOING ON");
    for (const paragraph of brief.situation.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
      html.push(
        `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#525252;">${escapeHtml(paragraph)}</p>`
      );
      text.push(paragraph, "");
    }
    html.push(`</td></tr>`);
  }

  if (brief.newsHighlights?.length) {
    html.push(
      `<tr><td style="padding:18px 28px 0 28px;">`,
      `<p style="margin:0 0 8px 0;padding-top:14px;border-top:1px solid #f5f5f5;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#a3a3a3;">Headlines</p>`
    );
    text.push("HEADLINES");
    for (const item of brief.newsHighlights) {
      html.push(
        `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;">`,
        `<a href="${escapeHtml(safeUrl(item.url))}" style="color:#3730a3;text-decoration:none;">${escapeHtml(item.title)}</a>`,
        `<span style="color:#a3a3a3;font-size:12px;"> · ${escapeHtml(item.source)}</span></p>`
      );
      text.push(`- ${item.title} (${item.source})`, `  ${item.url}`);
    }
    html.push(`</td></tr>`);
    text.push("");
  }

  html.push(
    `<tr><td style="padding:22px 28px 26px 28px;">`,
    `<p style="margin:0;padding-top:14px;border-top:1px solid #f5f5f5;font-size:12px;color:#a3a3a3;">`,
    `<a href="${escapeHtml(APP_URL)}/dashboard" style="color:#525252;">Open Nexus</a> · `,
    `<a href="${escapeHtml(APP_URL)}/dashboard/settings" style="color:#525252;">Change what you get, or stop these</a>`,
    `</p></td></tr>`,
    `</table></div>`
  );
  text.push("---", `Open Nexus: ${APP_URL}/dashboard`, `Change or stop these: ${APP_URL}/dashboard/settings`);

  return {
    to,
    // The headline is the subject. A fixed "Your morning brief" tells the
    // reader nothing at a glance, which is the one moment that decides
    // whether this gets opened.
    subject: brief.headline.slice(0, 120),
    html: html.join(""),
    text: text.join("\n"),
  };
}
