"use client";

import { useState } from "react";
import type { ConnectionView } from "@/lib/services/integration";
import { Badge, Button, Card, CardHeader, Notice } from "@/components/ui";
import { ConnectionForm } from "@/components/integrations/connection-form";
import { IntegrationActions } from "@/components/integrations/integration-actions";
import { LiveModeControl } from "@/components/integrations/live-mode-control";
import { dateTime } from "@/lib/format";

function ModeBadge({ mode }: { mode: ConnectionView["effective_mode"] }) {
  if (mode === "mock") return <Badge tone="gold">MOCK</Badge>;
  if (mode === "live") return <Badge tone="danger">LIVE</Badge>;
  return <Badge tone="warning">LIVE — disabled</Badge>;
}

export function IntegrationConnections({ connections, canVerify, phrase, view }: { view?: "api" | "webhook"; connections: ConnectionView[]; canVerify: boolean; phrase: string }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      {connections.map((connection) => (
        <Card key={connection.id}>
          <CardHeader
            title={<span className="flex flex-wrap items-center gap-2">{connection.name} <ModeBadge mode={connection.effective_mode} />
              <Badge>{connection.connection_type.toUpperCase()}</Badge>
              {connection.is_enabled ? <Badge tone="success">enabled</Badge> : <Badge>disabled</Badge>}
            </span>}
            subtitle={`Last success: ${connection.last_success_at ? dateTime(connection.last_success_at) : "never"}`}
          />
          {connection.last_error && <div className="px-5 pt-4"><Notice tone="danger" title="Last error">{connection.last_error}</Notice></div>}
          {connection.mode === "live" && !connection.live_runtime_enabled && (
            <div className="px-5 pt-4"><Notice tone="warning" title="Live mode is switched off on the server">UNIKLIFE_LIVE_ENABLED is not true, so the HTTP connector refuses to send.</Notice></div>
          )}
          <ConnectionForm view={view}
            initial={{
              connection_type: connection.connection_type,
              name: connection.name,
              is_enabled: connection.is_enabled,
              destination_url: connection.destination_url,
              auth_type: connection.auth_type,
              inbound_auth_type: connection.inbound_auth_type,
              outbound_auth_header_name: connection.outbound_auth_header_name,
              inbound_auth_header_name: connection.inbound_auth_header_name,
              outbound_secret_env: connection.outbound_secret_env,
              inbound_secret_env: connection.inbound_secret_env,
              event_mappings: connection.event_mappings ?? {},
            }}
            envStatus={connection.env_status}
            inboundUrl={connection.inbound_url}
            connectionId={connection.id}
          />
          {view !== "webhook" && <div className="border-t border-border p-5">
            <CardHeader title="Test & dispatch · Live mode" subtitle="Test this connection or manage its delivery mode." />
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <IntegrationActions enabled={connection.is_enabled && connection.connection_type !== "webhook"} connectionId={connection.id} />
                <p className="mt-3 text-xs text-muted">In MOCK mode, test events appear in the Mock CRM inbox on the logs page.</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted">{connection.live_verified_at ? `Verified ${dateTime(connection.live_verified_at)}` : "Not verified — MOCK only"}</p>
                <LiveModeControl mode={connection.mode} canVerify={canVerify} phrase={phrase} connectionId={connection.id}
                  available={connection.connection_type !== "webhook"} />
              </div>
            </div>
          </div>}
        </Card>
      ))}
      {creating ? (
        <Card>
          <CardHeader title="Create API or Webhook" subtitle="A new connection starts in MOCK mode." />
          <ConnectionForm view={view} initial={null} envStatus={null} inboundUrl={connections[0]?.inbound_url ?? ""} connectionId={null} onCreated={() => setCreating(false)} />
        </Card>
      ) : (
        <Button variant="gold" onClick={() => setCreating(true)}>+ Create more APIs & Webhooks</Button>
      )}
      {!connections.length && !creating && <p className="text-sm text-muted">No connections yet. Create an API or Webhook to get started.</p>}
    </div>
  );
}
