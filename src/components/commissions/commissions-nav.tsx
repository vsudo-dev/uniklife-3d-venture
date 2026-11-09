import Link from "next/link";
import { cx } from "@/components/ui";

/** Section tabs shared by the commission screens (only shows what the caller may open). */
export function CommissionsNav({ active, canPlans, canSettlements }: { active: "ledger" | "plans" | "settlements"; canPlans: boolean; canSettlements: boolean }) {
  const items = [
    { key: "ledger", href: "/commissions", label: "Ledger", show: true },
    { key: "plans", href: "/commissions/plans", label: "Plans & simulator", show: canPlans },
    { key: "settlements", href: "/commissions/settlements", label: "Settlements & finance", show: canSettlements },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return (
    <nav aria-label="Commission sections" className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1 shadow-[var(--shadow)]">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={active === i.key ? "page" : undefined}
          className={cx(
            "whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition",
            active === i.key ? "bg-primary-strong text-white shadow-sm ring-1 ring-gold/40" : "text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Tab links inside a page (query-string driven). */
export function TabLinks({ tabs, active }: { tabs: { key: string; href: string; label: string; count?: number }[]; active: string }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border px-3">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={active === t.key}
          className={cx(
            "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition",
            active === t.key ? "border-gold text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cx("rounded-full px-1.5 py-0.5 text-[0.7rem] font-bold", active === t.key ? "bg-gold-soft text-gold-strong" : "bg-surface-2 text-muted")}>{t.count}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

export const downloadClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-text transition hover:border-gold";
