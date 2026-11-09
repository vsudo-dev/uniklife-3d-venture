"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button, Card, CardHeader, Field, cx } from "@/components/ui";
import { MessageLine, useAction } from "./use-action";

export interface EmployeeFormValues {
  fullName: string;
  mobile: string;
  email: string;
  designation: string;
  commissionLevel: string;
  commissionEligible: boolean;
  reportingManagerId: string;
  employmentStatus: "active" | "on_leave" | "resigned" | "terminated";
  joiningDate: string;
  ventureIds: string[];
  hrmReference: string;
}

export const EMPTY_EMPLOYEE: EmployeeFormValues = {
  fullName: "", mobile: "", email: "", designation: "", commissionLevel: "", commissionEligible: true, reportingManagerId: "",
  employmentStatus: "active", joiningDate: "", ventureIds: [], hrmReference: "",
};

interface Props {
  employeeId?: string;
  employeeCode?: string;
  initial: EmployeeFormValues;
  managers: { id: string; employee_code: string; full_name: string; commission_level: number | null; employment_status: string }[];
  ventures: { id: string; name: string; code: string }[];
}

export function EmployeeForm({ employeeId, employeeCode, initial, managers, ventures }: Props) {
  const router = useRouter();
  const [v, setV] = useState<EmployeeFormValues>(initial);
  const { busy, msg, run } = useAction();
  const set = <K extends keyof EmployeeFormValues>(k: K, val: EmployeeFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const options = managers.filter((m) => m.id !== employeeId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      fullName: v.fullName,
      mobile: v.mobile.trim() || null,
      email: v.email.trim() || null,
      designation: v.designation.trim() || null,
      commissionLevel: v.commissionLevel ? Number(v.commissionLevel) : null,
      commissionEligible: v.commissionEligible,
      reportingManagerId: v.reportingManagerId || null,
      employmentStatus: v.employmentStatus,
      joiningDate: v.joiningDate || null,
      ventureIds: v.ventureIds,
      hrmReference: v.hrmReference.trim() || null,
    };
    const r = await run(
      "save",
      () =>
        employeeId
          ? api<{ id: string; employeeCode: string }>(`/api/employees/${employeeId}`, { method: "PUT", body: payload })
          : api<{ id: string; employeeCode: string }>("/api/employees", { body: payload }),
      (res) => (employeeId ? "Employee updated" : `Employee created with ID ${res.employeeCode}`),
    );
    if (r && !employeeId) router.push(`/employees/${r.id}`);
  }

  return (
    <Card>
      <CardHeader
        title={employeeId ? "Edit employee" : "New employee"}
        subtitle={employeeId ? <>Employee ID <strong className="text-text">{employeeCode}</strong> (permanent)</> : "The employee ID is generated automatically and is unique in your organization."}
      />
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="emp-name">
          <input id="emp-name" className="input" required minLength={2} maxLength={160} value={v.fullName} onChange={(e) => set("fullName", e.target.value)} />
        </Field>
        <Field label="Designation" htmlFor="emp-designation">
          <input id="emp-designation" className="input" maxLength={80} value={v.designation} onChange={(e) => set("designation", e.target.value)} placeholder="e.g. Sales Executive" />
        </Field>
        <Field label="Mobile" htmlFor="emp-mobile">
          <input id="emp-mobile" className="input" inputMode="tel" value={v.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="+91 98xxxxxxx" />
        </Field>
        <Field label="Email" htmlFor="emp-email">
          <input id="emp-email" type="email" className="input" value={v.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Commission level" htmlFor="emp-level" hint="1 = top of the ladder (CEO) … 8. Leave empty if not on the commission ladder.">
          <select id="emp-level" className="input" value={v.commissionLevel} onChange={(e) => set("commissionLevel", e.target.value)}>
            <option value="">Not on ladder</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>Level {n}</option>)}
          </select>
        </Field>
        <Field label="Reporting manager" htmlFor="emp-manager" hint="Cycles in the reporting line are rejected.">
          <select id="emp-manager" className="input" value={v.reportingManagerId} onChange={(e) => set("reportingManagerId", e.target.value)}>
            <option value="">No manager (top level)</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name} · {m.employee_code}{m.commission_level ? ` · L${m.commission_level}` : ""}{m.employment_status !== "active" ? ` (${m.employment_status.replace("_", " ")})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employment status" htmlFor="emp-status">
          <select id="emp-status" className="input" value={v.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value as EmployeeFormValues["employmentStatus"])}>
            <option value="active">Active</option>
            <option value="on_leave">On leave</option>
            <option value="resigned">Resigned</option>
            <option value="terminated">Terminated</option>
          </select>
        </Field>
        <Field label="Joining date" htmlFor="emp-joining">
          <input id="emp-joining" type="date" className="input" value={v.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} />
        </Field>
        <Field label="HRM reference" htmlFor="emp-hrm" hint="Optional. Set manually or via an approved import — HRM sync requires a verified UNIKLIFE.AI HRM integration.">
          <input id="emp-hrm" className="input" maxLength={80} value={v.hrmReference} onChange={(e) => set("hrmReference", e.target.value)} />
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={v.commissionEligible} onChange={(e) => set("commissionEligible", e.target.checked)} />
            Eligible for commissions
          </label>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="label">Assigned ventures</legend>
          {ventures.length === 0 ? (
            <p className="text-sm text-muted">No ventures yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ventures.map((vt) => {
                const on = v.ventureIds.includes(vt.id);
                return (
                  <label key={vt.id} className={cx("cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition", on ? "border-gold bg-gold-soft text-gold-strong" : "border-border hover:border-gold")}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={(e) => set("ventureIds", e.target.checked ? [...v.ventureIds, vt.id] : v.ventureIds.filter((x) => x !== vt.id))}
                    />
                    {vt.name} <span className="opacity-60">{vt.code}</span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-muted">Venture managers and sales executives only see the ventures assigned to them.</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="gold" disabled={!!busy || v.fullName.trim().length < 2}>{busy ? "Saving…" : employeeId ? "Save changes" : "Create employee"}</Button>
          <MessageLine msg={msg} />
        </div>
      </form>
    </Card>
  );
}
