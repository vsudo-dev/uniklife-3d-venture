"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cx } from "@/components/ui";

/**
 * Collapses its content behind a compact toggle on phones; always expanded from `sm` up.
 * Used for long filter forms so content (plots, bookings…) is visible immediately.
 */
export function MobileCollapse({ label = "Filters", activeCount = 0, children }: { label?: string; activeCount?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 sm:mb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center justify-between rounded-xl border border-border bg-surface px-3 text-sm font-semibold sm:hidden"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-gold-strong" />
          {label}
          {activeCount > 0 && <span className="rounded-full bg-gold px-1.5 text-[0.65rem] font-bold text-[#1b1400]">{activeCount}</span>}
        </span>
        <ChevronDown size={16} className={cx("transition", open && "rotate-180")} />
      </button>
      <div className={cx(open ? "mt-2 block" : "hidden", "sm:mt-0 sm:block")}>{children}</div>
    </div>
  );
}
