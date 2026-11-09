import { requirePageContext, getBranding } from "@/lib/auth/server";
import { AppNav } from "@/components/shell/app-nav";
import { visibleNav } from "@/components/shell/nav-config";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { unreadCount } from "@/lib/services/notifications";
import { LiveNotificationAlerts } from "@/components/admin/live-notification-alerts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const branding = await getBranding();
  const unread = ctx.role === "customer" ? 0 : await unreadCount(ctx);
  return (
    <div className="min-h-dvh">
      <AppNav
        items={visibleNav(ctx.role)}
        appName={branding.appName}
        logoUrl={branding.logoUrl}
        logoWidth={branding.logoWidth}
        logoHeight={branding.logoHeight}
        userName={ctx.user.fullName}
        roleLabel={ROLE_LABELS[ctx.role]}
        orgName={ctx.organizationName}
        unread={unread}
        isCustomer={ctx.role === "customer"}
      />
      {ctx.role !== "customer" && <LiveNotificationAlerts />}
      <main className="px-3 pb-24 pt-3 sm:px-6 sm:pb-28 sm:pt-5 lg:ml-64 lg:px-8 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
