import Link from "next/link";

export function IntegrationNav() {
  return <nav aria-label="Integration workspace" className="mb-6 flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3 text-sm font-semibold">
    <Link className="rounded-lg px-3 py-2 hover:bg-surface-2" href="/integrations?tab=api">API</Link>
    <Link className="rounded-lg px-3 py-2 hover:bg-surface-2" href="/integrations?tab=webhook">Webhook</Link>
    <Link className="rounded-lg px-3 py-2 text-primary hover:bg-surface-2" href="/integrations/sync">Sync System</Link>
    <Link className="rounded-lg px-3 py-2 hover:bg-surface-2" href="/integrations/meta">Meta Lead Ads</Link>
    <Link className="rounded-lg px-3 py-2 hover:bg-surface-2" href="/whatsapp">WhatsApp</Link>
    <Link className="rounded-lg px-3 py-2 hover:bg-surface-2" href="/integrations/email">Email &amp; SMTP</Link>
    <Link className="rounded-lg px-3 py-2 hover:bg-surface-2" href="/integrations/maps">Google Maps</Link>
  </nav>;
}
