import { clerkClient } from "@clerk/nextjs/server";
import { getSupabaseAdmin, errorMessage } from "./supabase";
import { revokeGoogleAccess } from "./google";

// Every table that holds rows keyed by a Clerk user id. A new table that
// stores anything about a user belongs on this list — otherwise "delete
// my account" quietly leaves it behind.
const USER_TABLES = [
  "google_tokens",
  "apple_credentials",
  "prep_items",
  "prep_generations",
  "action_log",
  "user_facts",
  "brief_cache",
  "brief_deliveries",
  "rate_limits",
  "user_profile",
] as const;

// Permanently removes everything Nexus holds about one person, then the
// sign-in itself. Google's API user-data policy requires apps that read
// Gmail to offer this, and it's what anyone would expect "delete my
// account" to mean.
//
// Order matters: the Google grant is revoked before its row is deleted
// (afterwards there's nothing to revoke with), and the Clerk user goes
// last so a failure partway through leaves the person able to sign in
// and try again rather than orphaning data under an id nobody owns.
export async function deleteAccount(userId: string): Promise<void> {
  await revokeGoogleAccess(userId);

  const supabase = getSupabaseAdmin();
  const failures: string[] = [];
  for (const table of USER_TABLES) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    // A table that doesn't exist yet (a migration not applied) has
    // nothing to delete; anything else is a real failure.
    if (error && error.code !== "42P01" && error.code !== "PGRST205") {
      failures.push(`${table}: ${errorMessage(error)}`);
    }
  }
  if (failures.length) {
    throw new Error(`Couldn't delete all data: ${failures.join("; ")}`);
  }

  const clerk = await clerkClient();
  await clerk.users.deleteUser(userId);
}
