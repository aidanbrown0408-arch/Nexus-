import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

// Clerk's hosted sign-up UI. See app/sign-in for why the route is a
// catch-all.
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <SignUp />
    </main>
  );
}
