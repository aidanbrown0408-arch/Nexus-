import { NextResponse, type NextRequest } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { generateBrief } from "@/lib/brief";
import { renderBriefEmail } from "@/lib/brief-email";
import { isMailerConfigured, sendEmail } from "@/lib/mailer";
import {
  alreadyDelivered,
  claimDelivery,
  releaseDelivery,
} from "@/lib/deliveries";
import { listDeliveryCandidates, type DeliveryCandidate } from "@/lib/profile";
import {
  deliveryWindow,
  GRACE_HOURS,
  type DeliveryWindow,
} from "@/lib/schedule";
import { errorMessage } from "@/lib/supabase";
import { secretsMatch } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The brief is a multi-second model call and this route may make several.
export const maxDuration = 300;

// Stop starting new deliveries well before the platform's limit. A brief
// takes 12-20 seconds, so leaving a minute of headroom means the one in
// flight finishes rather than being killed holding a delivery claim.
const BUDGET_MS = 240_000;

// The scheduled brief.
//
// Runs hourly and sends to whoever's morning has just arrived. Hourly
// rather than "at 7am" because 7am is a different instant for every user
// — the schedule is per-person and lives in their profile, not in cron.
//
// The bar for putting something in someone's inbox unasked is high, so
// the guards here are deliberately strict and each one fails toward
// silence:
//
//   - Only users who finished the interview and chose a morning time.
//   - Only in the hour that matches that time, in their zone.
//   - Never twice in one day, even if the job overlaps or retries.
//   - Never on a weekend for someone who said not to.
//   - Never a degraded brief. A first scheduled email that says the
//     calendar was unavailable is a bad first impression that arrives
//     without being asked for.

async function emailFor(userId: string): Promise<string | null> {
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    return user.primaryEmailAddress?.emailAddress ?? null;
  } catch (err) {
    console.error(`[cron] no address for ${userId}`, errorMessage(err));
    return null;
  }
}

async function deliver(candidate: DeliveryCandidate, window: DeliveryWindow) {
  const { user_id: userId } = candidate;
  const { day } = window;

  if (await alreadyDelivered(userId, day)) return "already_sent";

  const to = await emailFor(userId);
  if (!to) return "no_address";

  // Claimed before the work, so two overlapping runs can't both generate
  // a brief and both send it. The claim is released if anything after
  // this fails, which lets the next hourly run retry.
  if (!(await claimDelivery(userId, day))) return "claimed_elsewhere";

  try {
    const result = await generateBrief(userId);
    if (!result.ok) {
      await releaseDelivery(userId, day);
      return `generate_failed:${result.code ?? result.status}`;
    }

    // A brief built while something was *down* is fine to show someone
    // who asked for it, and not fine to push at them — it'll be right
    // again within the hour.
    //
    // A missing API key is not that. `marketsUnavailable:
    // "not_configured"` is a stable fact about the deployment, so
    // treating it as an outage means anyone who ticked financial news
    // never receives a brief again, silently and forever. Send it; the
    // brief says what's missing.
    const outage =
      result.brief.calendarUnavailable ||
      result.brief.mailUnavailable ||
      result.brief.newsUnavailable === "fetch_failed" ||
      result.brief.marketsUnavailable === "fetch_failed";
    if (outage) {
      await releaseDelivery(userId, day);
      return "outage_skipped";
    }

    const outcome = await sendEmail(renderBriefEmail(result.brief, to));
    if (outcome === "failed") {
      await releaseDelivery(userId, day);
      return "send_failed";
    }
    if (outcome === "unknown") {
      // The provider may well have accepted it. Keeping the claim risks
      // one missed brief; dropping it risks sending the same one twice,
      // and a duplicate is the failure that gets an assistant muted.
      console.error(`[cron] send outcome unknown for ${userId} — keeping claim`);
      return "send_unknown";
    }
    return "sent";
  } catch (err) {
    await releaseDelivery(userId, day);
    console.error(`[cron] delivery failed for ${userId}`, errorMessage(err));
    return "error";
  }
}

export async function GET(request: NextRequest) {
  // Vercel Cron sends this header; anything else reaching this route is
  // someone poking at it. Without the check, a stranger could make you
  // pay for a model call per request.
  // Compared in constant time. A plain `!==` on a secret leaks its
  // prefix through timing, and lib/crypto already has the primitive —
  // there was no reason this one check wasn't using it.
  const secret = process.env.CRON_SECRET;
  const presented = request.headers.get("authorization");
  if (!secret || !presented || !secretsMatch(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isMailerConfigured()) {
    console.error("[cron] mailer not configured — nothing sent");
    return NextResponse.json({ error: "Mailer not configured" }, { status: 503 });
  }

  const startedAt = Date.now();
  const now = new Date();
  const candidates = await listDeliveryCandidates();

  // Who was eligible but not in their window right now.
  //
  // This number is the single best signal that the cron is not running
  // often enough. The schedule in lib/schedule.ts only answers yes
  // within GRACE_HOURS of a user's chosen morning, which assumes this
  // route is invoked hourly. Invoked once a day instead, it can only
  // ever serve the users whose morning happens to fall in that one
  // hour's window, and everyone else is skipped silently, forever —
  // which is indistinguishable from the feature working.
  //
  // So it is said out loud. If `notDue` is large on every run and
  // `due` is a small, unchanging set, the cron frequency is the bug.
  const notDue = candidates.length - candidates
    .filter((candidate) => deliveryWindow(candidate, now) !== null).length;

  const due = candidates
    .map((candidate) => ({ candidate, window: deliveryWindow(candidate, now) }))
    .filter(
      (entry): entry is { candidate: DeliveryCandidate; window: DeliveryWindow } =>
        entry.window !== null
    )
    // Deterministic order, then rotated by the hour. Without the
    // rotation the same users sit at the head of the list every run, so
    // whenever the window runs out it is always the same tail that gets
    // dropped — the last few users would simply never receive a brief.
    .sort((a, b) => a.candidate.user_id.localeCompare(b.candidate.user_id));

  if (due.length) {
    const offset = now.getUTCHours() % due.length;
    due.push(...due.splice(0, offset));
  }

  console.log(`[cron] ${due.length} of ${candidates.length} due this hour`);
  if (notDue > 0) {
    console.log(
      `[cron] ${notDue} eligible user(s) outside their ${GRACE_HOURS}h ` +
        "window on this run. That is expected when the cron fires hourly " +
        "and most people's morning is not now. If this route runs less " +
        "often than hourly, those users are never served — see " +
        "vercel.json and the scheduling section of SETUP.md."
    );
  }

  // Sequential on purpose. Each delivery is a model call and an inbox
  // read; running the whole list at once would spike every upstream rate
  // limit at the top of the hour for no gain, since nobody is waiting on
  // this response.
  //
  // The budget stops the platform killing the function mid-delivery,
  // which is the one way a user can be marked delivered without being
  // sent anything: the claim is taken before the work, and a killed
  // process runs no release.
  const outcomes: Record<string, number> = {};
  let deferred = 0;

  for (const { candidate, window } of due) {
    if (Date.now() - startedAt > BUDGET_MS) {
      deferred += 1;
      continue;
    }
    const outcome = await deliver(candidate, window);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  if (deferred) {
    // Said out loud rather than silently truncated. These are still
    // inside the grace window, so the next hourly run picks them up.
    console.log(`[cron] ${deferred} deferred to the next run — out of time`);
  }

  return NextResponse.json({
    due: due.length,
    // Surfaced in the response as well as the log, so a manual curl
    // against this route shows the same thing without digging.
    eligible: candidates.length,
    notDue,
    deferred,
    outcomes,
  });
}
