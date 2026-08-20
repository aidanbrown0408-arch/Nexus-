import { getSupabaseAdmin } from "./supabase";

// Has this user already been sent today's brief?
//
// The scheduler runs hourly and picks up anyone whose morning has
// arrived, so "already sent" is the ordinary case, checked far more often
// than it's written. It is also the only thing standing between a retry
// and a duplicate — an assistant that emails you the same brief twice is
// one you filter to a folder.

export async function alreadyDelivered(
  userId: string,
  day: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brief_deliveries")
      .select("user_id")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    if (error) {
      console.error("Delivery check failed", error.message);
      // Fail closed. An unreachable table should mean "don't send",
      // never "send again" — a missed brief is a disappointment, a
      // duplicate is a reason to unsubscribe.
      return true;
    }
    return Boolean(data);
  } catch (err) {
    console.error(
      "Delivery check failed",
      err instanceof Error ? err.message : String(err)
    );
    return true;
  }
}

/**
 * Claim today's delivery for this user.
 *
 * Returns false when the row already existed, which is what makes two
 * overlapping cron runs safe: both check, both may see nothing, and only
 * one insert survives the primary key.
 */
export async function claimDelivery(
  userId: string,
  day: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("brief_deliveries")
      .insert({ user_id: userId, day });
    if (error) {
      // 23505 is unique_violation: someone else claimed it first, which
      // is a correct outcome rather than a failure.
      if (error.code === "23505") return false;
      console.error("Delivery claim failed", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "Delivery claim failed",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

// A claim made before a send that then failed would silence tomorrow's
// brief too if it were left in place. Releasing it lets the next hourly
// run try again.
export async function releaseDelivery(
  userId: string,
  day: string
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from("brief_deliveries")
      .delete()
      .eq("user_id", userId)
      .eq("day", day);
  } catch (err) {
    console.error(
      "Delivery release failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}
