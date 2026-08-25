"use client";

import { useState } from "react";
import BriefSection from "./BriefSection";
import ChatSection from "./ChatSection";
import GmailSection from "./GmailSection";
import CalendarSection from "./CalendarSection";

type Focus = "gmail" | "calendar" | null;

// The three-column board, plus a full screen mode for the Inbox and
// Calendar panels. Full screen collapses the assistant down to a slim bar
// — orb, status, Voice/Text — pinned above whichever panel took over the
// row, so you can keep talking to Nexus without leaving the expanded
// view. Brief and the other panel step aside entirely; there's nothing
// else to look at while one thing has the floor.
export default function Board() {
  const [focus, setFocus] = useState<Focus>(null);

  if (focus) {
    return (
      <div className="flex flex-col gap-4 py-4 lg:h-[calc(100vh-11.5rem)]">
        <ChatSection variant="compact" onExitFocus={() => setFocus(null)} />
        <div className="min-h-0 flex-1">
          {focus === "gmail" ? (
            <GmailSection focused onToggleFocus={() => setFocus(null)} />
          ) : (
            <CalendarSection focused onToggleFocus={() => setFocus(null)} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 py-4 lg:h-[calc(100vh-11.5rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_minmax(0,0.9fr)]">
      <div className="order-2 h-[60vh] lg:order-1 lg:h-full lg:min-h-0">
        <GmailSection onToggleFocus={() => setFocus("gmail")} />
      </div>

      <div className="order-1 flex min-h-[60vh] flex-col gap-4 lg:order-2 lg:h-full lg:min-h-0">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatSection />
        </div>
        <BriefSection />
      </div>

      <div className="order-3 h-[60vh] lg:h-full lg:min-h-0">
        <CalendarSection onToggleFocus={() => setFocus("calendar")} />
      </div>
    </div>
  );
}
