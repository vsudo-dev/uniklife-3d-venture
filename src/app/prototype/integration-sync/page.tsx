import Link from "next/link";
import { notFound } from "next/navigation";
import { SyncLab } from "@/components/integrations/sync-lab";

export const metadata = { title: "Local integration prototype" };
export const dynamic = "force-dynamic";
export default function LocalSyncPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8"><div className="mb-5 flex flex-wrap justify-between gap-3 text-sm"><strong>UNIKLIFE / LOCAL DESIGN PREVIEW</strong><Link className="font-semibold text-primary underline" href="/staff">Open Staff &amp; Access →</Link></div><SyncLab /></main>;
}
