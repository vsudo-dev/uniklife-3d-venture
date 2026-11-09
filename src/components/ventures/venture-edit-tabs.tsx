import Link from "next/link";
import { FileText, Sparkles } from "lucide-react";
import { cx } from "@/components/ui";

/** Section navigation for the Edit Venture module. */
export function VentureEditTabs({ ventureId, active }: { ventureId: string; active: "details" | "presentation" }) {
  const tabs = [
    { id: "details", label: "Venture details", href: `/ventures/${ventureId}/edit`, Icon: FileText },
    { id: "presentation", label: "Viewer & presentation", href: `/ventures/${ventureId}/edit/presentation`, Icon: Sparkles },
  ] as const;
  return (
    <nav aria-label="Edit venture sections" className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-border px-1">
      {tabs.map(({ id, label, href, Icon }) => (
        <Link
          key={id}
          href={href}
          aria-current={active === id ? "page" : undefined}
          className={cx(
            "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition",
            active === id ? "border-gold text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          <Icon size={16} aria-hidden className={active === id ? "text-gold" : undefined} /> {label}
        </Link>
      ))}
    </nav>
  );
}
