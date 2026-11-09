import Link from "next/link";
import { MapPin } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { listVentures } from "@/lib/services/ventures";
import { Badge, Card, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { StatusBar } from "@/components/charts";
import { inr } from "@/lib/format";

export const metadata = { title: "Ventures" };

export default async function VenturesPage() {
  const ctx = await requirePageContext();
  const ventures = await listVentures(ctx);
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Ventures"
        subtitle="Browse ventures, open the interactive 3D layout and check live plot availability."
        actions={can(ctx, "venture.create") ? <LinkButton href="/ventures/new">New venture</LinkButton> : undefined}
      />
      {ventures.length === 0 ? (
        <Card><EmptyState title="No ventures yet">{can(ctx, "venture.create") ? "Create your first venture to start adding plots." : "No ventures are available to you yet."}</EmptyState></Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {ventures.map((v) => (
            <Link key={v.id} href={`/ventures/${v.id}`} className="card card-holo group overflow-hidden" data-testid="venture-card">
              <div
                className="premium-hero relative h-40 bg-cover bg-center p-4 text-white"
                style={
                  v.cover_image_asset_id
                    ? { backgroundImage: `linear-gradient(180deg, rgba(5,10,30,.15), rgba(5,10,30,.75)), url(/api/ventures/${v.id}/assets/${v.cover_image_asset_id})` }
                    : v.is_demo
                      ? { backgroundImage: "linear-gradient(180deg, rgba(5,10,30,.1), rgba(5,10,30,.75)), url(/samples/demo-venture-aerial.jpg)" }
                      : undefined
                }
              >
                {v.is_demo && !v.cover_image_asset_id && <span className="absolute bottom-1 right-2 text-[0.6rem] text-white/70">3D render of demonstration layout</span>}
                <div className="flex items-start justify-between gap-2">
                  <Badge tone="gold" className="bg-black/30 text-[#f3dc8a]">{v.code}</Badge>
                  {v.is_demo && <span className="rounded-md bg-black/40 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-[#f3dc8a]">Demo</span>}
                </div>
                <h2 className="absolute bottom-3 left-4 right-4 text-lg font-extrabold leading-tight">{v.name}</h2>
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1 text-muted"><MapPin size={14} />{[v.city, v.state].filter(Boolean).join(", ") || v.location_text || "—"}</span>
                  <StatusBadge status={v.status} />
                </div>
                <StatusBar counts={v as unknown as Record<string, number>} />
                <div className="flex justify-between border-t border-border pt-3 text-sm">
                  <span className="text-muted">{v.total_plots} plots</span>
                  <span className="font-semibold">{v.min_price ? `${inr(v.min_price, { compact: true })} – ${inr(v.max_price, { compact: true })}` : "—"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
