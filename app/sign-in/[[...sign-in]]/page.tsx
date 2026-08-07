import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

// Clerk's hosted sign-in UI. The [[...sign-in]] catch-all route lets Clerk
// handle its own sub-steps (e.g. password reset, 2FA) under this same path.
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <SignIn />
    </main>
  );
}
