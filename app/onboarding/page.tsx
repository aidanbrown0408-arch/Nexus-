import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { hasSeenOnboarding } from "@/lib/profile";
import { errorMessage } from "@/lib/supabase";
import OnboardingFlow from "./OnboardingFlow";

export const dynamic = "force-dynamic";

// The interview. Reached by redirect from the dashboard on first visit,
// and only worth showing once — someone who already finished or skipped
// gets sent on rather than asked again.
export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Resolved before the redirect, not inside a try around it — redirect()
  // works by throwing, so calling it in the try block would have the catch
  // swallow it and render the interview anyway.
  let seen = false;
  try {
    seen = await hasSeenOnboarding(userId);
  } catch (err) {
    // Supabase being down shouldn't strand someone on a blank screen.
    // Showing the interview again is the safe failure: worst case they
    // re-answer, which overwrites with the same thing.
    console.error("Onboarding check failed", errorMessage(err));
  }

  if (seen) redirect("/dashboard");

  return <OnboardingFlow />;
}
