"use client";

import { useEffect } from "react";
import Link from "next/link";

// Catches a render error anywhere below the root layout, so a single
// broken panel shows a way back instead of a blank page.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-[60vh] place-items-center px-6">
      <div className="text-center">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          It&apos;s been logged. Trying again usually fixes it.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={reset} className="nx-btn-primary nx-btn-sm">
            Try again
          </button>
          <Link href="/dashboard" className="nx-btn-quiet nx-btn-sm">
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
