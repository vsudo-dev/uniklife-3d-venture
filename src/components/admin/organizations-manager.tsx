"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, Field, StatusBadge } from "@/components/ui";
import { date } from "@/lib/format";
import { MessageLine, useAction } from "./use-action";

export interface OrgItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  staff_count: number;
  customer_count: number;
  employee_count: number;
  venture_count: number;
  booking_count: number;
  primary_domain: string | null;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

function CreateOrgForm() {
  const [f, setF] = useState({ name: "", slug: "", slugTouched: false, contactEmail: "", adminEmail: "", adminName: "", adminPassword: "" });
  const { busy, msg, run } = useAction();
  const pwBad = f.adminPassword && (f.adminPassword.length < 10 || !/[A-Za-z]/.test(f.adminPassword) || !/[0-9]/.test(f.adminPassword));
  return (
    <form
      className="grid gap-4 p-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(
          "create",
          () => api<{ adminEmployeeCode: string }>("/api/organizations", {
            body: { name: f.name, slug: f.slug, contactEmail: f.contactEmail || null, adminEmail: f.adminEmail, adminName: f.adminName, adminPassword: f.adminPassword },
          }),
          (res) => `Organization created. Administrator employee ID ${res.adminEmployeeCode}.`,
        );
        if (r) setF({ name: "", slug: "", slugTouched: false, contactEmail: "", adminEmail: "", adminName: "", adminPassword: "" });
      }}
    >
      <Field label="Organization name" htmlFor="org-name">
        <input id="org-name" className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slugTouched ? f.slug : slugify(e.target.value) })} />
      </Field>
      <Field label="Slug" htmlFor="org-slug" hint="Lowercase letters, digits and hyphens. Permanent.">
        <input id="org-slug" className="input font-mono" required pattern="[a-z0-9][a-z0-9-]{1,62}" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase(), slugTouched: true })} />
      </Field>
      <Field label="Contact email" htmlFor="org-contact"><input id="org-contact" type="email" className="input" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
      <div className="hidden sm:block" />
      <div className="sm:col-span-2 text-xs font-bold uppercase tracking-[0.18em] text-gold">Initial organization administrator</div>
      <Field label="Administrator name" htmlFor="org-admin-name"><input id="org-admin-name" className="input" required minLength={2} value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></Field>
      <Field label="Administrator email" htmlFor="org-admin-email"><input id="org-admin-email" type="email" className="input" required value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
      <Field label="Temporary password" htmlFor="org-admin-pw" error={pwBad ? "Min 10 characters with letters and numbers" : null} hint="Share securely; ask the administrator to change it.">
        <input id="org-admin-pw" className="input font-mono" autoComplete="new-password" required value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} />
      </Field>
      <p className="self-end text-xs text-muted">An employee record at commission level 1 is created and linked automatically.</p>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="gold" disabled={!!busy || !!pwBad}><Plus size={16} aria-hidden /> {busy ? "Creating…" : "Create organization"}</Button>
        <MessageLine msg={msg} />
      </div>
    </form>
  );
}

export function OrganizationsManager({ orgs, activeOrgId }: { orgs: OrgItem[]; activeOrgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { busy, msg, run } = useAction();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="New organization"
          subtitle="Creates a tenant with its first administrator."
          action={<Button variant={open ? "ghost" : "gold"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Close" : <><Building2 size={16} aria-hidden /> Create</>}</Button>}
        />
        {open && <CreateOrgForm />}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title={`Organizations (${orgs.length})`} />
        {msg && <div className="px-5 pt-3"><MessageLine msg={msg} /></div>}
        <div className="overflow-x-auto">
          <table className="table min-w-[960px]">
            <thead>
              <tr><th>Organization</th><th>Status</th><th className="text-right">Staff</th><th className="text-right">Customers</th><th className="text-right">Employees</th><th className="text-right">Ventures</th><th className="text-right">Bookings</th><th>Created</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="font-semibold">{o.name} {o.id === activeOrgId && <Badge tone="gold">active</Badge>}</div>
                    <div className="font-mono text-xs text-muted">{o.slug}{o.primary_domain ? ` · ${o.primary_domain}` : ""}</div>
                  </td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="text-right tabular-nums">{o.staff_count}</td>
                  <td className="text-right tabular-nums">{o.customer_count}</td>
                  <td className="text-right tabular-nums">{o.employee_count}</td>
                  <td className="text-right tabular-nums">{o.venture_count}</td>
                  <td className="text-right tabular-nums">{o.booking_count}</td>
                  <td className="whitespace-nowrap text-xs">{date(o.created_at)}</td>
                  <td>
                    <div className="flex justify-end gap-2">
                      {o.id !== activeOrgId && (
                        <button className="rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:border-gold disabled:opacity-50" disabled={!!busy}
                          onClick={async () => { const r = await run("switch", () => api<{ redirectTo: string }>("/api/organizations/switch", { body: { organizationId: o.id } }), `Switched to ${o.name}`); if (r) router.push(r.redirectTo); }}>
                          Switch to
                        </button>
                      )}
                      {o.status === "active" ? (
                        <button className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-danger hover:border-danger disabled:opacity-50" disabled={!!busy}
                          onClick={() => { if (window.confirm(`Suspend ${o.name}? Its users will be unable to sign in until reactivated.`)) void run("status", () => api(`/api/organizations/${o.id}`, { method: "PATCH", body: { status: "suspended" } }), `${o.name} suspended`); }}>
                          Suspend
                        </button>
                      ) : (
                        <button className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-success hover:border-success disabled:opacity-50" disabled={!!busy}
                          onClick={() => run("status", () => api(`/api/organizations/${o.id}`, { method: "PATCH", body: { status: "active" } }), `${o.name} reactivated`)}>
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
