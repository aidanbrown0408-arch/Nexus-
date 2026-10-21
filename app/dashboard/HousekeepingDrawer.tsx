"use client";

import { useEffect, useState } from "react";
import TriageSection from "./TriageSection";
import FiltersSection from "./FiltersSection";
import { PanelIcon, PanelIconButton } from "./PanelActions";

// Inbox housekeeping (Tidy up + Filters), opened from the Inbox header.
//
// It used to be a disclosure under the board, which pushed the page
// taller and spilled two big cards across the bottom when opened. As a
// side drawer it's one click away from the inbox it acts on and never
// disturbs the layout.
export default function HousekeepingDrawer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <PanelIconButton
        icon="sparkles"
        label="Inbox housekeeping"
        onClick={() => setOpen(true)}
        expanded={open}
      />

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close housekeeping"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="housekeeping-title"
            className="relative flex h-full w-full max-w-[600px] flex-col bg-canvas shadow-pop"
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-6 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-50 text-accent-600">
                <PanelIcon name="sparkles" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  id="housekeeping-title"
                  className="text-[17px] font-semibold tracking-tight text-ink"
                >
                  Inbox housekeeping
                </h2>
                <p className="text-[13px] text-ink-ghost">
                  Clear out noise and set up filters
                </p>
              </div>
              <PanelIconButton
                icon="x"
                label="Close"
                onClick={() => setOpen(false)}
              />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 [&>section:first-child]:mt-6 [&>section]:mt-5">
              <TriageSection />
              <FiltersSection />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
