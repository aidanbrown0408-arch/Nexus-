"use client";

import { Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Board from "./Board";
import BriefSection from "./BriefSection";
import ChatSection from "./ChatSection";
import GmailSection from "./GmailSection";
import CalendarSection from "./CalendarSection";
import RemindersSection from "./RemindersSection";
import { parseView, type View } from "./views";

// Renders whichever dashboard page the URL points at.
//
// The switcher itself lives in the shared header (AppHeader), so it's the
// same on every signed-in page. Which page you're on lives in the URL
// rather than in state — that's what makes Back work, lets the morning
// brief email link straight to ?view=reminders, and keeps a refresh
// where you were.
function DashboardTabsInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const view = parseView(searchParams.get("view"));

  // push, not replace: switching pages is navigation, and Back should
  // undo it.
  const go = useCallback(
    (next: View) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "board") params.delete("view");
      else params.set("view", next);
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  if (view === "board") return <Board onOpenPage={go} />;

  // Every page keeps the assistant on it, collapsed to a slim bar, so
  // leaving the inbox or the calendar doesn't mean leaving Nexus.
  return (
    <div className="flex flex-col gap-4 py-6 lg:h-screen lg:py-7">
      <ChatSection variant="compact" onExitFocus={() => go("board")} />
      <div className="min-h-0 flex-1">
        {view === "email" ? (
          <GmailSection focused onToggleFocus={() => go("board")} />
        ) : view === "calendar" ? (
          <CalendarSection focused onToggleFocus={() => go("board")} />
        ) : view === "reminders" ? (
          <section className="nx-board-panel">
            <header className="nx-board-head">
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                Reminders
              </h2>
              <p className="truncate text-[13px] text-ink-ghost">
                Everything that needs doing, soonest first
              </p>
            </header>
            <RemindersSection variant="page" />
          </section>
        ) : (
          <BriefSection variant="page" />
        )}
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary to keep the route from being
// forced fully dynamic at build time.
export default function DashboardTabs() {
  return (
    <Suspense fallback={<div className="py-5" />}>
      <DashboardTabsInner />
    </Suspense>
  );
}
