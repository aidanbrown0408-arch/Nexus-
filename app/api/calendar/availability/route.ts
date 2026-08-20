import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  CALENDAR_READONLY_SCOPE,
} from "@/lib/google";
import {
  eventsToBusy,
  fetchGoogleBusy,
  findSlots,
  type AvailabilityRequest,
  type BusyBlock,
} from "@/lib/availability";
import { fetchAppleEvents, getAppleCredentials } from "@/lib/apple";
import { getProfile } from "@/lib/profile";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DAYS = 30;
const MAX_DURATION = 8 * 60;

// Propose times that are actually free.
//
// Reads only. Nothing is held, blocked, or sent — the user picks a slot,
// which fills in the event form, and creating it goes through the same
// confirm-and-create path as any other event. Proposing a time and
// booking it are separate on purpose: the roadmap's rule is that
// anything reaching other people is explicit, and a "hold" that quietly
// appeared on someone's calendar would not be.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let spec: AvailabilityRequest;
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const durationMinutes =
      typeof body.durationMinutes === "number" ? body.durationMinutes : 30;
    const daysAhead = typeof body.daysAhead === "number" ? body.daysAhead : 7;

    if (durationMinutes < 5 || durationMinutes > MAX_DURATION) {
      return NextResponse.json(
        { error: "Pick a length between 5 minutes and 8 hours." },
        { status: 422 }
      );
    }
    if (daysAhead < 1 || daysAhead > MAX_DAYS) {
      return NextResponse.json(
        { error: "Look ahead between 1 and 30 days." },
        { status: 422 }
      );
    }

    spec = {
      durationMinutes,
      daysAhead,
      workdayStartHour:
        typeof body.workdayStartHour === "number" ? body.workdayStartHour : 9,
      workdayEndHour:
        typeof body.workdayEndHour === "number" ? body.workdayEndHour : 18,
      // The browser's zone as a fallback; the profile's answer wins
      // below. Without one of the two, working hours are read on the
      // host, which is UTC.
      timeZone: typeof body.timeZone === "string" ? body.timeZone : null,
      guestEmails: Array.isArray(body.guestEmails)
        ? body.guestEmails
            .filter((g): g is string => typeof g === "string")
            .filter((g) => g.includes("@"))
            .slice(0, 20)
        : [],
    };
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  // What the user said their day looks like beats what their browser
  // reports, since the profile is the answer they gave deliberately.
  try {
    const profile = await getProfile(userId);
    if (profile?.timezone) spec.timeZone = profile.timezone;
  } catch (err) {
    console.error("Availability: profile unavailable", errorMessage(err));
  }

  try {
    const busy: BusyBlock[] = [];
    let unknownGuests: string[] = [];

    // Both services are consulted, and one being unreachable degrades
    // the answer rather than failing it — but the response says which,
    // because a slot found without checking a calendar isn't the same
    // promise as one found with it.
    const client = await getAuthorizedClientForUser(userId);
    let googleChecked = false;
    if (client && hasScope(client.credentials.scope, CALENDAR_READONLY_SCOPE)) {
      try {
        const result = await fetchGoogleBusy(client, spec);
        busy.push(...result.busy);
        unknownGuests = result.unknownGuests;
        googleChecked = true;
      } catch (err) {
        console.error("Google freebusy failed", errorMessage(err));
      }
    }

    let appleChecked = false;
    try {
      const credentials = await getAppleCredentials(userId);
      if (credentials) {
        // CalDAV has no freebusy, so busy-ness is derived from the same
        // events the Upcoming list is built from.
        const events = await fetchAppleEvents(credentials, spec.daysAhead);
        busy.push(...eventsToBusy(events));
        appleChecked = true;
      }
    } catch (err) {
      console.error("Apple busy lookup failed", errorMessage(err));
    }

    if (!googleChecked && !appleChecked) {
      return NextResponse.json(
        {
          error: "No calendar Nexus can read. Connect one first.",
          code: "not_connected",
        },
        { status: 400 }
      );
    }

    const slots = findSlots(busy, spec);

    return NextResponse.json({
      slots,
      unknownGuests,
      checked: { google: googleChecked, apple: appleChecked },
    });
  } catch (err) {
    console.error("Availability failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't work out when you're free.", code: "availability_failed" },
      { status: 503 }
    );
  }
}
