"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilLine, Plus } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui";

/**
 * Creates a new DRAFT version (approved versions are never edited):
 *  - with `fromPlanId`: one-click "Edit plan" — a copy of that version with the same scope;
 *  - without: a new plan copied from the latest organization-wide plan (change its scope in the editor).
 */
export function NewVersionButton({
  fromPlanId, label, hasOpenDraft = false, variant = "gold", size = "md",
}: {
  fromPlanId?: string;
  label?: string;
  hasOpenDraft?: boolean;
  variant?: "gold" | "outline" | "ghost";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = fromPlanId ? PencilLine : Plus;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={variant}
        className={size === "sm" ? "!px-2.5 !py-1 !text-xs" : undefined}
        disabled={busy}
        onClick={async () => {
          if (hasOpenDraft && !window.confirm("A draft already exists for this scope. Create another new version anyway?")) return;
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ id: string; version: number }>("/api/commissions/plans", { body: fromPlanId ? { fromPlanId } : {} });
            router.push(`/commissions/plans?plan=${r.id}`);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon size={size === "sm" ? 12 : 16} aria-hidden /> {busy ? "Creating…" : (label ?? (fromPlanId ? "Edit plan" : "New plan"))}
      </Button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
