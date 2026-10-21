"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import BriefSection from "./BriefSection";
import ChatSection from "./ChatSection";
import GmailSection from "./GmailSection";
import CalendarSection from "./CalendarSection";

// The Home page: a greeting, then three columns — inbox on the left, the
// assistant in the middle with the morning brief under it, calendar on
// the right. Below lg it stacks, assistant first, since on a phone the
// thing you came to do is talk to it.
//
// The full-screen buttons change the page (to the Email / Calendar
// views) rather than holding their own state, so there's one source of
// truth for which view you're on.
export default function Board({
  onOpenPage,
}: {
  onOpenPage: (view: "email" | "calendar") => void;
}) {
  // When the brief is open it takes the middle column, and the assistant
  // folds down to its slim bar above it — so you can read the brief and
  // still ask about it.
  const [briefOpen, setBriefOpen] = useState(false);

  return (
    <div className="flex flex-col gap-5 py-6 lg:h-screen lg:py-7">
      <Greeting />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_minmax(0,0.9fr)]">
        <div className="order-2 h-[60vh] lg:order-1 lg:h-full lg:min-h-0">
          <GmailSection onToggleFocus={() => onOpenPage("email")} />
        </div>

        <div className="order-1 flex min-h-[60vh] flex-col gap-4 lg:order-2 lg:h-full lg:min-h-0">
          {/* Both shapes read the same conversation (ChatContext), so
              opening the brief no longer throws it away. */}
          {briefOpen ? (
            <ChatSection variant="compact" />
          ) : (
            <div className="min-h-[520px] flex-1 lg:min-h-0">
              <ChatSection />
            </div>
          )}
          <BriefSection onOpenChange={setBriefOpen} />
        </div>

        <div className="order-3 h-[60vh] lg:h-full lg:min-h-0">
          <CalendarSection onToggleFocus={() => onOpenPage("calendar")} />
        </div>
      </div>
    </div>
  );
}

// "Good morning, Aidan" plus the date. Computed after mount so the
// server's clock and timezone never leak into the greeting.
function Greeting() {
  const { user } = useUser();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  const hour = now?.getHours() ?? 12;
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = user?.firstName;

  return (
    <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">
          {now ? `Good ${part}${name ? `, ${name}` : ""}` : " "}
        </h1>
        <p className="mt-1 text-[15px] text-ink-muted">
          Here&apos;s what&apos;s happening across your inbox and calendar.
        </p>
      </div>
      {now && (
        <p className="text-[15px] font-medium text-ink-ghost">
          {now.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      )}
    </div>
  );
}
