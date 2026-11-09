import type { NextRequest } from "next/server";
import { errorResponse, json } from "@/lib/api";
import { getAuthContext } from "@/lib/auth/server";
import { unauthorized } from "@/lib/errors";
import { isUuid } from "@/lib/services/common";
import { assertVentureViewable, plotStatusSnapshot, sweepExpired } from "@/lib/services/plot-status";

export const dynamic = "force-dynamic";
// Serverless-friendly: each stream lives < 60 s, the browser's EventSource reconnects automatically.
export const maxDuration = 60;

const POLL_MS = 2500;
const SWEEP_MS = 15000;
const STREAM_MS = 50000;

/**
 * GET /api/live/ventures/:id
 *  - Accept: text/event-stream → Server-Sent Events stream of plot status changes.
 *  - otherwise → JSON snapshot (used to revalidate before booking and as the client fallback).
 * Authenticated and tenant-scoped; payload contains plot ids and statuses only.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext();
    if (!ctx) throw unauthorized();
    if (!isUuid(id)) return json({ error: { code: "not_found", message: "Venture not found" } }, 404);
    await assertVentureViewable(ctx, id);

    if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) {
      return json({ plots: await plotStatusSnapshot(ctx, id), at: new Date().toISOString() });
    }

    // Writer-based stream: the producer loop runs independently of the response object,
    // which serverless runtimes (Vercel) flush chunk by chunk.
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let closed = false;
    req.signal.addEventListener("abort", () => {
      closed = true;
    });
    const send = async (chunk: string) => {
      if (closed) return;
      try {
        await writer.write(encoder.encode(chunk));
      } catch {
        closed = true; // client went away
      }
    };

    (async () => {
      const started = Date.now();
      let known = new Map((await plotStatusSnapshot(ctx, id)).map((p) => [p.id, p.version]));
      let lastSweep = 0;
      await send(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      while (!closed && Date.now() - started < STREAM_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (closed) break;
        try {
          if (Date.now() - lastSweep > SWEEP_MS) {
            lastSweep = Date.now();
            await sweepExpired(ctx.organizationId);
          }
          const rows = await plotStatusSnapshot(ctx, id);
          const changed = rows.filter((r) => known.get(r.id) !== r.version).map((r) => ({ id: r.id, status: r.status }));
          known = new Map(rows.map((r) => [r.id, r.version]));
          // Heartbeats are named events (comments are invisible to EventSource) so the client can detect stalls.
          await send(changed.length ? `event: status\ndata: ${JSON.stringify(changed)}\n\n` : `event: ping\ndata: {}\n\n`);
        } catch {
          await send(`event: ping\ndata: {"degraded":true}\n\n`);
        }
      }
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    })().catch(() => {
      writer.close().catch(() => undefined);
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
