"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/client/api";

export type Msg = { tone: "ok" | "err"; text: string; details?: string[] } | null;

function detailLines(e: unknown): string[] | undefined {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return undefined;
  const lines = (e.details as unknown[])
    .map((d) => {
      if (d && typeof d === "object" && "message" in d) {
        const o = d as { path?: string; message: string };
        return o.path ? `${o.path}: ${o.message}` : o.message;
      }
      return null;
    })
    .filter((x): x is string => !!x);
  return lines.length ? lines.slice(0, 8) : undefined;
}

/** Runs an async mutation with busy/message state and refreshes server data on success. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(label);
      setMsg(null);
      try {
        const r = await fn();
        if (ok) setMsg({ tone: "ok", text: typeof ok === "function" ? ok(r) : ok });
        router.refresh();
        return r;
      } catch (e) {
        setMsg({ tone: "err", text: (e as Error).message, details: detailLines(e) });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );
  return { busy, msg, setMsg, run };
}

export function MessageLine({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div role="status" aria-live="polite" className={msg.tone === "ok" ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
      {msg.text}
      {msg.details && (
        <ul className="mt-1 list-disc pl-5 text-xs font-normal">
          {msg.details.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}
