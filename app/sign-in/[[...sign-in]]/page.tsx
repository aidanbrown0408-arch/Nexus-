import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

// Clerk's hosted sign-in UI. The [[...sign-in]] catch-all route lets Clerk
// handle its own sub-steps (e.g. password reset, 2FA) under this same path.
export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[19px] font-semibold tracking-tight">Nexus</span>
        <span className="nx-label">assistant</span>
      </div>
      <SignIn />
    </main>
  );
}
