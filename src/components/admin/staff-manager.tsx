"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, UserPlus } from "lucide-react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, StatusBadge, cx } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { MessageLine, useAction } from "./use-action";

export interface StaffRow {
  member_id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  user_status: string;
  last_login_at: string | null;
  employee_id: string | null;
  employee_code: string | null;
  other_org_count: number;
}

interface Props {
  rows: StaffRow[];
  currentUserId: string;
  roles: { id: string; label: string }[];
  managers: { id: string; employee_code: string; full_name: string }[];
  ventures: { id: string; name: string }[];
  isPlatformAdmin: boolean;
}

function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "At least 10 characters";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Must contain letters and numbers";
  return null;
}

function CreateStaffForm({ roles, managers, ventures }: Pick<Props, "roles" | "managers" | "ventures">) {
  const [f, setF] = useState({
    email: "", fullName: "", phone: "", role: roles[roles.length - 1]?.id ?? "sales_executive", temporaryPassword: "",
    linkEmployee: true, designation: "", commissionLevel: "", reportingManagerId: "", joiningDate: "", ventureIds: [] as string[],
  });
  const { busy, msg, run } = useAction();
  const pwErr = f.temporaryPassword ? passwordProblem(f.temporaryPassword) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(
      "create",
      () =>
        api<{ employeeCode: string | null }>("/api/staff", {
          body: {
            email: f.email, fullName: f.fullName, phone: f.phone || null, role: f.role, temporaryPassword: f.temporaryPassword,
            employee: f.linkEmployee
              ? { designation: f.designation || null, commissionLevel: f.commissionLevel ? Number(f.commissionLevel) : null, reportingManagerId: f.reportingManagerId || null, joiningDate: f.joiningDate || null, ventureIds: f.ventureIds }
              : null,
          },
        }),
      (res) => `Staff user created${res.employeeCode ? ` with employee ID ${res.employeeCode}` : ""}. Share the temporary password securely.`,
    );
    if (r) setF((s) => ({ ...s, email: "", fullName: "", phone: "", temporaryPassword: "", designation: "", commissionLevel: "", reportingManagerId: "", joiningDate: "", ventureIds: [] }));
  }

  return (
    <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label="Full name" htmlFor="st-name"><input id="st-name" className="input" required minLength={2} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
      <Field label="Email (login)" htmlFor="st-email"><input id="st-email" type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Phone" htmlFor="st-phone"><input id="st-phone" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Role" htmlFor="st-role">
        <select id="st-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Temporary password" htmlFor="st-pw" error={pwErr} hint="Min 10 characters with letters and numbers. Ask the user to change it after first sign-in.">
        <input id="st-pw" type="text" autoComplete="new-password" className="input font-mono" required value={f.temporaryPassword} onChange={(e) => setF({ ...f, temporaryPassword: e.target.value })} />
      </Field>
      <div className="flex items-end">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={f.linkEmployee} onChange={(e) => setF({ ...f, linkEmployee: e.target.checked })} />
          Also create a linked employee record
        </label>
      </div>
      {f.linkEmployee && (
        <div className="grid gap-4 rounded-xl border border-border bg-surface-2/50 p-4 sm:col-span-2 sm:grid-cols-2">
          <Field label="Designation" htmlFor="st-des"><input id="st-des" className="input" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
          <Field label="Commission level" htmlFor="st-level">
            <select id="st-level" className="input" value={f.commissionLevel} onChange={(e) => setF({ ...f, commissionLevel: e.target.value })}>
              <option value="">Not on ladder</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>Level {n}</option>)}
            </select>
          </Field>
          <Field label="Reporting manager" htmlFor="st-mgr">
            <select id="st-mgr" className="input" value={f.reportingManagerId} onChange={(e) => setF({ ...f, reportingManagerId: e.target.value })}>
              <option value="">No manager</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {m.employee_code}</option>)}
            </select>
          </Field>
          <Field label="Joining date" htmlFor="st-join"><input id="st-join" type="date" className="input" value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></Field>
          {ventures.length > 0 && (
            <fieldset className="sm:col-span-2">
              <legend className="label">Assigned ventures</legend>
              <div className="flex flex-wrap gap-2">
                {ventures.map((v) => {
                  const on = f.ventureIds.includes(v.id);
                  return (
                    <label key={v.id} className={cx("cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-gold bg-gold-soft text-gold-strong" : "border-border hover:border-gold")}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setF({ ...f, ventureIds: e.target.checked ? [...f.ventureIds, v.id] : f.ventureIds.filter((x) => x !== v.id) })} />
                      {v.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <p className="text-xs text-muted sm:col-span-2">The employee ID is generated automatically. User, membership and employee are created in one transaction.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="gold" disabled={!!busy || !!pwErr || !f.temporaryPassword}><UserPlus size={16} aria-hidden /> {busy ? "Creating…" : "Create staff user"}</Button>
        <MessageLine msg={msg} />
      </div>
    </form>
  );
}

function ResetPassword({ memberId, email }: { memberId: string; email: string }) {
  const [pw, setPw] = useState("");
  const { busy, msg, run } = useAction();
  const err = pw ? passwordProblem(pw) : null;
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:border-gold">
        <KeyRound size={12} aria-hidden /> Reset password
      </summary>
      <div className="mt-2 w-64 space-y-2 rounded-xl border border-border bg-surface p-3 shadow-lg">
        <label className="label" htmlFor={`pw-${memberId}`}>New temporary password for {email}</label>
        <input id={`pw-${memberId}`} className="input font-mono" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p className="text-xs text-danger">{err}</p>}
        <Button variant="outline" className="w-full" disabled={!!busy || !pw || !!err}
          onClick={() => run("reset", () => api(`/api/staff/${memberId}/reset-password`, { body: { temporaryPassword: pw } }), "Temporary password set").then((r) => { if (r) setPw(""); })}>
          Set temporary password
        </Button>
        <MessageLine msg={msg} />
      </div>
    </details>
  );
}

export function StaffManager({ rows, currentUserId, roles, managers, ventures, isPlatformAdmin }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const { busy, msg, run } = useAction();
  const roleLabel = (id: string) => roles.find((r) => r.id === id)?.label ?? id.replace(/_/g, " ");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Invite / create staff user"
          subtitle="Creates a login with a temporary password. Roles are enforced on the server."
          action={<Button variant={showCreate ? "ghost" : "gold"} onClick={() => setShowCreate((s) => !s)} aria-expanded={showCreate}>{showCreate ? "Close" : <><UserPlus size={16} aria-hidden /> New staff user</>}</Button>}
        />
        {showCreate && <CreateStaffForm roles={roles} managers={managers} ventures={ventures} />}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={`Members (${rows.length})`} subtitle="You cannot disable yourself or the last active organization administrator." />
        {msg && <div className="px-5 pt-3"><MessageLine msg={msg} /></div>}
        {rows.length === 0 ? <EmptyState title="No staff yet" /> : (
          <div className="overflow-x-auto">
            <table className="table min-w-[980px]">
              <thead>
                <tr><th>User</th><th>Role</th><th>Status</th><th>Employee</th><th>Last login</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const self = m.user_id === currentUserId;
                  const canReset = isPlatformAdmin || m.other_org_count === 0;
                  return (
                    <tr key={m.member_id} className={m.status === "disabled" ? "opacity-60" : undefined}>
                      <td>
                        <div className="font-semibold">{m.full_name} {self && <Badge tone="gold">you</Badge>}</div>
                        <div className="text-xs text-muted">{m.email}</div>
                        {m.other_org_count > 0 && <div className="text-[0.7rem] text-muted">Also in {m.other_org_count} other organization(s)</div>}
                      </td>
                      <td>
                        {m.role === "customer" ? <Badge>Customer</Badge> : (
                          <select
                            className="input min-w-[190px] py-1.5 text-xs"
                            aria-label={`Role for ${m.email}`}
                            value={m.role}
                            disabled={!!busy}
                            onChange={(e) => run(`role-${m.member_id}`, () => api(`/api/staff/${m.member_id}`, { method: "PATCH", body: { role: e.target.value } }), `Role updated for ${m.email}`)}
                          >
                            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                            {!roles.some((r) => r.id === m.role) && <option value={m.role}>{roleLabel(m.role)}</option>}
                          </select>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={m.status} />
                        {m.user_status === "disabled" && <div className="mt-1 text-[0.7rem] text-danger">account disabled</div>}
                      </td>
                      <td>{m.employee_id ? <Link href={`/employees/${m.employee_id}`} className="font-mono text-xs font-bold text-primary hover:underline">{m.employee_code}</Link> : <span className="text-xs text-muted">not linked</span>}</td>
                      <td className="whitespace-nowrap text-xs">{m.last_login_at ? dateTime(m.last_login_at) : <span className="text-muted">never</span>}</td>
                      <td>
                        <div className="flex flex-wrap items-start justify-end gap-2">
                          {canReset && <ResetPassword memberId={m.member_id} email={m.email} />}
                          {m.status === "active" ? (
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-danger hover:border-danger disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={!!busy || self}
                              title={self ? "You cannot disable your own access" : undefined}
                              onClick={() => { if (window.confirm(`Disable access for ${m.email}?`)) void run(`st-${m.member_id}`, () => api(`/api/staff/${m.member_id}`, { method: "PATCH", body: { status: "disabled" } }), `Access disabled for ${m.email}`); }}
                            >
                              Disable
                            </button>
                          ) : (
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-success hover:border-success disabled:opacity-40"
                              disabled={!!busy}
                              onClick={() => run(`st-${m.member_id}`, () => api(`/api/staff/${m.member_id}`, { method: "PATCH", body: { status: "active" } }), `Access enabled for ${m.email}`)}
                            >
                              Enable
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
