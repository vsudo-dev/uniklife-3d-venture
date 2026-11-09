import Link from "next/link";
import { Bell, Building2, Palette, UserRound } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { getMyProfile } from "@/lib/services/staff";
import { getOrgSettings, switchableOrganizations } from "@/lib/services/organizations";
import { getBrandingSettings, listDomains, THEMES } from "@/lib/services/branding";
import { getMyPreferences } from "@/lib/services/notifications";
import { Card, LinkButton, PageHeader, cx } from "@/components/ui";
import { OrgSettingsForm, OrgSwitcher, PasswordForm, ProfileForm } from "@/components/admin/settings-forms";
import { BrandingForm, DomainManager, LogoUpload } from "@/components/admin/branding-settings";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

type Tab = "profile" | "notifications" | "organization" | "branding";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const tabs: { id: Tab; label: string; Icon: typeof UserRound; show: boolean }[] = [
    { id: "profile", label: "Profile", Icon: UserRound, show: true },
    { id: "notifications", label: "Notifications", Icon: Bell, show: true },
    { id: "organization", label: "Organization", Icon: Building2, show: can(ctx, "org.manage") },
    { id: "branding", label: "Company branding", Icon: Palette, show: can(ctx, "branding.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const tab: Tab = visible.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "profile";

  return (
    <>
      <PageHeader eyebrow={ROLE_LABELS[ctx.role]} title="Settings" subtitle={`${ctx.user.fullName} · ${ctx.organizationName}`} />
      <nav aria-label="Settings sections" className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-border px-1">
        {visible.map(({ id, label, Icon }) => (
          <Link
            key={id}
            href={`/settings?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={cx(
              "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition",
              tab === id ? "border-gold text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            <Icon size={16} aria-hidden className={tab === id ? "text-gold" : undefined} /> {label}
          </Link>
        ))}
      </nav>
      {tab === "profile" && <ProfileTab ctx={ctx} />}
      {tab === "notifications" && <NotificationsTab ctx={ctx} />}
      {tab === "organization" && <OrganizationTab ctx={ctx} />}
      {tab === "branding" && <BrandingTab ctx={ctx} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requirePageContext>>;

async function ProfileTab({ ctx }: { ctx: Ctx }) {
  const [p, orgs] = await Promise.all([getMyProfile(ctx), switchableOrganizations(ctx)]);
  return (
    <div className="max-w-4xl space-y-6">
      <ProfileForm initial={{ email: p.email, fullName: p.full_name, phone: p.phone ?? "" }} />
      <PasswordForm external={p.auth_provider !== "local"} />
      {orgs.length > 1 && <OrgSwitcher current={ctx.organizationId} options={orgs} />}
      {ctx.employee && (
        <Card className="p-5 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Your employee ID</div>
          <div className="mt-1 font-mono text-lg font-extrabold">{ctx.employee.code}</div>
          <p className="mt-1 text-xs text-muted">Use this ID for sales attribution. It is permanent and unique within {ctx.organizationName}.</p>
        </Card>
      )}
    </div>
  );
}

async function NotificationsTab({ ctx }: { ctx: Ctx }) {
  const prefs = await getMyPreferences(ctx);
  const on = (b: boolean) => (b ? "On" : "Off");
  return (
    <Card className="max-w-2xl p-6">
      <h2 className="text-base font-bold">Notification preferences</h2>
      <p className="mt-1 text-sm text-muted">Manage how you receive team booking alerts, follow-up reminders and updates from the notification center.</p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">In-app</dt><dd className="font-semibold">{on(prefs.in_app)}</dd></div>
        <div><dt className="text-muted">Dashboard alerts</dt><dd className="font-semibold">{on(prefs.dashboard_alerts)}</dd></div>
        <div><dt className="text-muted">Push</dt><dd className="font-semibold">{on(prefs.push)}</dd></div>
        <div><dt className="text-muted">WhatsApp (UNIKLIFE.AI)</dt><dd className="font-semibold">{on(prefs.whatsapp_via_uniklife)}</dd></div>
        <div><dt className="text-muted">Email (UNIKLIFE.AI)</dt><dd className="font-semibold">{on(prefs.email_via_uniklife)}</dd></div>
      </dl>
      <LinkButton href="/notifications#preferences" variant="gold" className="mt-5">Open notification preferences</LinkButton>
    </Card>
  );
}

async function OrganizationTab({ ctx }: { ctx: Ctx }) {
  const s = await getOrgSettings(ctx);
  return (
    <div className="max-w-5xl">
      <OrgSettingsForm initial={s} />
    </div>
  );
}

async function BrandingTab({ ctx }: { ctx: Ctx }) {
  const [b, domains] = await Promise.all([getBrandingSettings(ctx), listDomains(ctx)]);
  return (
    <div className="max-w-6xl space-y-6">
      <BrandingForm initial={b} themes={THEMES} />
      <LogoUpload logoUrl={b.logoUrl} logoMime={b.logoMime} logoWidth={b.logoWidth} logoHeight={b.logoHeight} version={b.brandingVersion} />
      <DomainManager domains={domains.map((d) => ({ id: d.id, domain: d.domain, is_primary: d.is_primary, verified: d.verified }))} />
    </div>
  );
}
