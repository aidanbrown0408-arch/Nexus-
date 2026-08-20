import { getSupabaseAdmin, type BriefCacheRow } from "./supabase";

// Today's brief, stored so it's written once and read many times.
//
// The brief costs a model call over the entire inbox and calendar, takes
// the better part of twenty seconds, and is identical on every load until
// something actually changes. Without this, opening the dashboard twice
// paid for it twice — and React's development double-render made that
// four times.
//
// Deliberately a whole-day cache rather than a short TTL. A morning brief
// is a point-in-time artifact: it says what to do today and it should
// keep saying that, rather than quietly rewriting itself each time the
// tab regains focus. When the user wants a fresh read they ask for one,
// and that path is explicit rather than accidental.

export type CachedBrief<T> = {
  brief: T;
  generatedAt: string;
};

export async function readCachedBrief<T>(
  userId: string,
  day: string,
  isValid: (value: unknown) => boolean = () => true
): Promise<CachedBrief<T> | null> {
  try {
    return await read<T>(userId, day, isValid);
  } catch (err) {
    // getSupabaseAdmin throws on missing configuration. A cache that
    // can't be reached is a cache miss, never an error the user sees.
    console.error(
      "Brief cache read failed",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

async function read<T>(
  userId: string,
  day: string,
  isValid: (value: unknown) => boolean
): Promise<CachedBrief<T> | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("brief_cache")
    .select("brief, created_at")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();

  // A cache miss and a cache failure are the same thing to the caller:
  // generate it. Nothing here should ever be the reason a brief doesn't
  // appear.
  if (error) {
    console.error("Brief cache read failed", error.message);
    return null;
  }
  if (!data?.brief) return null;

  // A stored brief was written by whatever shipped yesterday. Validating
  // on read means a shape change costs a regeneration rather than a
  // component rendering undefined into the page.
  if (!isValid(data.brief)) {
    console.error("Brief cache: stored brief no longer matches the shape");
    return null;
  }

  return {
    brief: data.brief as T,
    generatedAt: data.created_at ?? new Date().toISOString(),
  };
}

export async function writeCachedBrief(
  userId: string,
  day: string,
  brief: unknown
): Promise<string | null> {
  try {
    return await write(userId, day, brief);
  } catch (err) {
    // Same reasoning as the read: the user has their brief in hand by
    // the time this runs. Failing to store it costs them the next one's
    // latency, not this one's existence.
    console.error(
      "Brief cache write failed",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

async function write(
  userId: string,
  day: string,
  brief: unknown
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const generatedAt = new Date().toISOString();

  const row: BriefCacheRow = {
    user_id: userId,
    day,
    brief,
    created_at: generatedAt,
  };

  // Upsert on the composite key so a regenerate replaces the day's brief
  // rather than accumulating rows nobody reads.
  const { error } = await supabase
    .from("brief_cache")
    .upsert(row, { onConflict: "user_id,day" });

  if (error) {
    console.error("Brief cache write failed", error.message);
    return null;
  }
  return generatedAt;
}

// Any day but today is dead weight. Deliberately "not equal to today"
// rather than "older than today": moving timezone west shifts the key
// backwards, and a strictly-older prune would leave the future-dated row
// behind — unreachable for a day, and then served as this morning's
// brief when the date caught up to it.
export async function pruneOtherDays(
  userId: string,
  today: string
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("brief_cache")
      .delete()
      .eq("user_id", userId)
      .neq("day", today);
    if (error) console.error("Brief cache prune failed", error.message);
  } catch (err) {
    console.error(
      "Brief cache prune failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}
