"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, MoonStar, Sun } from "lucide-react";
import { cx } from "@/components/ui";

type Pref = "system" | "light" | "dark" | "night";
const OPTIONS: { id: Pref; label: string; Icon: typeof Sun; hint: string }[] = [
  { id: "light", label: "Light", Icon: Sun, hint: "Bright surfaces" },
  { id: "dark", label: "Dark", Icon: Moon, hint: "Brand-tinted dark" },
  { id: "night", label: "Night", Icon: MoonStar, hint: "Deep black, warm low-blue text" },
  { id: "system", label: "System", Icon: Monitor, hint: "Follow device setting" },
];

function apply(pref: Pref) {
  const root = document.documentElement;
  const mode = pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
  root.classList.add("theme-switching");
  root.dataset.mode = mode;
  root.dataset.modePref = pref;
  window.setTimeout(() => root.classList.remove("theme-switching"), 300);
  document.cookie = `ul_mode=${pref}; path=/; max-age=31536000; samesite=lax`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && mode !== "light") meta.setAttribute("content", mode === "night" ? "#060504" : "#070a14");
}

/** Always-visible segmented control (desktop): Light | Dark | Night | System. */
function SegmentedModes({ pref, onPick, className }: { pref: Pref; onPick: (p: Pref) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Colour mode" className={cx("items-center gap-0.5 rounded-full border border-border bg-surface-2/80 p-0.5 shadow-sm backdrop-blur", className)} data-testid="mode-segmented">
      {OPTIONS.map((o) => {
        const active = pref === o.id;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={active}
            title={`${o.label} — ${o.hint}`}
            onClick={() => onPick(o.id)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition",
              active ? "btn-holo btn-primary-holo text-white" : "text-muted hover:text-text",
            )}
            data-testid={`seg-mode-${o.id}`}
          >
            <o.Icon size={14} />
            {o.id === "system" ? <span className="sr-only">{o.label}</span> : o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Light / Dark / Night / System switcher. Stored per device (cookie) and applied instantly. */
export function ModeSwitcher({ compact, className, variant = "menu" }: { compact?: boolean; className?: string; variant?: "menu" | "segmented" }) {
  const [pref, setPref] = useState<Pref>("system");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPref((document.documentElement.dataset.modePref as Pref) || "system");
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((document.documentElement.dataset.modePref || "system") === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => {
      mq.removeEventListener("change", onChange);
      document.removeEventListener("click", close);
    };
  }, []);

  const current = OPTIONS.find((o) => o.id === pref) ?? OPTIONS[3];
  if (variant === "segmented") {
    return (
      <SegmentedModes
        pref={pref}
        className={className}
        onPick={(p) => {
          setPref(p);
          apply(p);
        }}
      />
    );
  }
  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Colour mode: ${current.label}`}
        className="inline-flex items-center gap-1.5 rounded-full p-2 hover:bg-surface-2"
        data-testid="mode-switcher"
      >
        <current.Icon size={18} />
        {!compact && <span className="hidden text-xs font-semibold sm:inline">{current.label}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              role="menuitemradio"
              aria-checked={pref === o.id}
              onClick={() => {
                setPref(o.id);
                apply(o.id);
                setOpen(false);
              }}
              className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2", pref === o.id && "bg-gold-soft")}
              data-testid={`mode-${o.id}`}
            >
              <o.Icon size={16} className={pref === o.id ? "text-gold-strong" : "text-muted"} />
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
