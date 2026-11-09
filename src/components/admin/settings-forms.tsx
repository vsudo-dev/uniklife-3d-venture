"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button, Card, CardHeader, Field } from "@/components/ui";
import { MessageLine, useAction } from "./use-action";

export function ProfileForm({ initial }: { initial: { email: string; fullName: string; phone: string } }) {
  const [f, setF] = useState(initial);
  const { busy, msg, run } = useAction();
  return (
    <Card>
      <CardHeader title="Profile" subtitle="Your name and phone appear on bookings and notifications you create." />
      <form
        className="grid gap-4 p-5 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); void run("save", () => api("/api/settings/profile", { method: "PUT", body: { fullName: f.fullName, phone: f.phone || null } }), "Profile saved"); }}
      >
        <Field label="Email (sign-in)" htmlFor="pf-email" hint="Contact your administrator to change your sign-in email.">
          <input id="pf-email" className="input" value={f.email} disabled readOnly />
        </Field>
        <Field label="Full name" htmlFor="pf-name">
          <input id="pf-name" className="input" required minLength={2} maxLength={160} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        </Field>
        <Field label="Phone" htmlFor="pf-phone">
          <input id="pf-phone" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="gold" disabled={!!busy}>{busy ? "Saving…" : "Save profile"}</Button>
          <MessageLine msg={msg} />
        </div>
      </form>
    </Card>
  );
}

export function PasswordForm({ external }: { external: boolean }) {
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const { busy, msg, run } = useAction();
  const problem =
    f.newPassword && f.newPassword.length < 10 ? "At least 10 characters"
    : f.newPassword && (!/[A-Za-z]/.test(f.newPassword) || !/[0-9]/.test(f.newPassword)) ? "Must contain letters and numbers"
    : f.confirm && f.confirm !== f.newPassword ? "Passwords do not match" : null;
  if (external) {
    return (
      <Card className="p-5 text-sm text-muted">Your password is managed by your organization&apos;s identity provider.</Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Change password" subtitle="You need your current password to set a new one." />
      <form
        className="grid gap-4 p-5 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run("pw", () => api("/api/settings/password", { body: { currentPassword: f.currentPassword, newPassword: f.newPassword } }), "Password changed");
          if (r) setF({ currentPassword: "", newPassword: "", confirm: "" });
        }}
      >
        <Field label="Current password" htmlFor="pw-cur">
          <input id="pw-cur" type="password" autoComplete="current-password" className="input" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password" htmlFor="pw-new" hint="Min 10 characters, letters and numbers.">
          <input id="pw-new" type="password" autoComplete="new-password" className="input" required value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-conf" error={problem}>
          <input id="pw-conf" type="password" autoComplete="new-password" className="input" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" variant="primary" disabled={!!busy || !!problem || !f.currentPassword || !f.newPassword || f.confirm !== f.newPassword}>{busy ? "Updating…" : "Change password"}</Button>
          <MessageLine msg={msg} />
        </div>
      </form>
    </Card>
  );
}

export function OrgSwitcher({ current, options, returnTo }: { current: string; options: { id: string; name: string; status: string; slug?: string; plot_count?: number }[]; returnTo?: string }) {
  const router = useRouter();
  const [sel, setSel] = useState(current);
  const { busy, msg, run } = useAction();
  return (
    <Card>
      <CardHeader title="Active organization" subtitle="Switch which organization you are working in." />
      <div className="flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="org-switch">Organization</label>
          <select id="org-switch" className="input" value={sel} onChange={(e) => setSel(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.slug ? ` · ${o.slug}` : ""}{o.plot_count !== undefined ? ` · ${o.plot_count} plots` : ""}{o.status !== "active" ? " (suspended)" : ""}</option>)}
          </select>
        </div>
        <Button
          variant="outline"
          disabled={!!busy || sel === current}
          onClick={async () => {
            const r = await run("switch", () => api<{ redirectTo: string }>("/api/organizations/switch", { body: { organizationId: sel } }), "Switched");
            if (r) { router.push(returnTo ?? r.redirectTo); router.refresh(); }
          }}
        >
          {busy ? "Switching…" : "Switch"}
        </Button>
        <MessageLine msg={msg} />
      </div>
    </Card>
  );
}

export interface OrgSettingsValues {
  holdMinutes: number;
  paymentWindowMinutes: number;
  bookingAmountPercent: number;
  allowDiscountStacking: boolean;
  maxDiscountPercent: number;
  discountApprovalThresholdPercent: number;
  followupReminderHours: number[];
  employeeCodePrefix: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  commissionRequiresSecondApprover?: boolean;
}

export function OrgSettingsForm({ initial }: { initial: OrgSettingsValues }) {
  const [f, setF] = useState({
    ...initial,
    hours: initial.followupReminderHours.join(", "),
    contactEmail: initial.contactEmail ?? "",
    contactPhone: initial.contactPhone ?? "",
    commissionRequiresSecondApprover: initial.commissionRequiresSecondApprover ?? true,
  });
  const { busy, msg, run } = useAction();
  const num = (k: "holdMinutes" | "paymentWindowMinutes" | "bookingAmountPercent" | "maxDiscountPercent" | "discountApprovalThresholdPercent") => ({
    value: String(f[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) }),
  });
  const hours = f.hours.split(/[,\s]+/).filter(Boolean).map(Number);
  const hoursBad = hours.some((h) => !Number.isInteger(h) || h < 1 || h > 720) || hours.length > 6;

  return (
    <Card>
      <CardHeader title="Organization settings" subtitle="Booking rules and defaults for everyone in your organization. Changes are audited." />
      <form
        className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run("save", () => api("/api/settings/organization", {
            method: "PUT",
            body: {
              holdMinutes: f.holdMinutes, paymentWindowMinutes: f.paymentWindowMinutes, bookingAmountPercent: f.bookingAmountPercent,
              allowDiscountStacking: f.allowDiscountStacking, maxDiscountPercent: f.maxDiscountPercent,
              discountApprovalThresholdPercent: f.discountApprovalThresholdPercent, followupReminderHours: hours,
              employeeCodePrefix: f.employeeCodePrefix, contactEmail: f.contactEmail || null, contactPhone: f.contactPhone || null,
              commissionRequiresSecondApprover: f.commissionRequiresSecondApprover,
            },
          }), "Organization settings saved");
        }}
      >
        <Field label="Plot hold (minutes)" htmlFor="os-hold" hint="How long selected plots stay held while a booking is completed (1–1440).">
          <input id="os-hold" type="number" min={1} max={1440} className="input" required {...num("holdMinutes")} />
        </Field>
        <Field label="Payment window (minutes)" htmlFor="os-pay" hint="Time to pay the advance after a booking request (5–10080).">
          <input id="os-pay" type="number" min={5} max={10080} className="input" required {...num("paymentWindowMinutes")} />
        </Field>
        <Field label="Booking amount (%)" htmlFor="os-adv" hint="Advance as a percentage of the net price.">
          <input id="os-adv" type="number" min={0.01} max={100} step={0.01} className="input" required {...num("bookingAmountPercent")} />
        </Field>
        <Field label="Maximum discount (%)" htmlFor="os-max">
          <input id="os-max" type="number" min={0} max={100} step={0.01} className="input" required {...num("maxDiscountPercent")} />
        </Field>
        <Field label="Approval threshold (%)" htmlFor="os-thr" hint="Discounts above this need approval.">
          <input id="os-thr" type="number" min={0} max={100} step={0.01} className="input" required {...num("discountApprovalThresholdPercent")} />
        </Field>
        <Field label="Follow-up reminders (hours)" htmlFor="os-hours" hint="Comma-separated, e.g. 24, 72. Sent to the seller and direct manager." error={hoursBad ? "Use up to 6 whole numbers between 1 and 720" : null}>
          <input id="os-hours" className="input" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
        </Field>
        <Field label="Employee ID prefix" htmlFor="os-prefix" hint="2–6 capital letters. Applies to newly created employees only (existing IDs never change).">
          <input id="os-prefix" className="input uppercase" maxLength={6} required value={f.employeeCodePrefix} onChange={(e) => setF({ ...f, employeeCodePrefix: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Contact email" htmlFor="os-email">
          <input id="os-email" type="email" className="input" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
        </Field>
        <Field label="Contact phone" htmlFor="os-phone">
          <input id="os-phone" className="input" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="flex items-start gap-3 rounded-xl border border-border p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--gold)]" checked={f.allowDiscountStacking} onChange={(e) => setF({ ...f, allowDiscountStacking: e.target.checked })} />
            <span>
              <span className="block text-sm font-semibold">Allow discount stacking</span>
              <span className="block text-xs text-muted">Off by default: only one discount applies per booking. When on, multiple stackable discounts may combine, still capped by the maximum discount.</span>
            </span>
          </label>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="flex items-start gap-3 rounded-xl border border-border p-3">
            <input type="checkbox" role="switch" aria-checked={f.commissionRequiresSecondApprover} className="mt-0.5 h-4 w-4 accent-[var(--gold)]" checked={f.commissionRequiresSecondApprover}
              onChange={(e) => setF({ ...f, commissionRequiresSecondApprover: e.target.checked })} />
            <span>
              <span className="block text-sm font-semibold">Require a second approver for commission plans</span>
              <span className="block text-xs text-muted">
                Four-eyes control (recommended): a commission plan can only be activated by someone other than the person who submitted it, so no single
                person can change commission rates on their own. Turn off only if your organization has a single administrator; every submission and
                approval is still recorded in the audit log.
              </span>
              {!f.commissionRequiresSecondApprover && (
                <span className="mt-1 block text-xs font-semibold text-warning">Off: the submitter can approve their own commission plan.</span>
              )}
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="gold" disabled={!!busy || hoursBad}>{busy ? "Saving…" : "Save settings"}</Button>
          <MessageLine msg={msg} />
        </div>
      </form>
    </Card>
  );
}
