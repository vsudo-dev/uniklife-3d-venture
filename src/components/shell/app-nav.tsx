"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity, Bell, Building2, CalendarDays, ChartColumn, ClipboardList, Coins, CreditCard, Grid3x3, History, House, Inbox,
  LogOut, Map, Menu, MessageCircle, Network, Plug, Settings, Shield, Tag, Users, X, type LucideIcon,
} from "lucide-react";
import type { NavItem } from "./nav-config";
import { BrandMark, cx } from "@/components/ui";
import { ModeSwitcher } from "@/components/theme/mode-switcher";

const ICONS: Record<string, LucideIcon> = {
  home: House, map: Map, grid: Grid3x3, clipboard: ClipboardList, inbox: Inbox, calendar: CalendarDays, network: Network,
  chart: ChartColumn, tag: Tag, card: CreditCard, coins: Coins, users: Users, shield: Shield, plug: Plug, activity: Activity,
  history: History, building: Building2, settings: Settings, message: MessageCircle,
};

const SECTION_LABEL: Record<NavItem["section"], string> = { main: "Workspace", sales: "Sales", finance: "Finance", admin: "Administration" };
const GROUP_LABEL: Record<NonNullable<NavItem["group"]>, string> = {
  inventory: "Ventures & Plot Inventory",
  staff: "Staff & Access",
  organization: "Organization",
  uniklife: "UNIKLIFE.AI",
  settings: "Preferences",
};

interface Props {
  items: NavItem[];
  appName: string;
  logoUrl: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  userName: string;
  roleLabel: string;
  orgName: string;
  unread: number;
  isCustomer: boolean;
}

function isActive(pathname: string, href: string) {
  if(href==="/integrations")return pathname.startsWith("/integrations")||pathname==="/whatsapp";
  if(href==="/commissions")return pathname==="/commissions";
  const target=href.split("?")[0];
  return pathname===target||pathname.startsWith(target+"/");
}

async function logout(router: ReturnType<typeof useRouter>) {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" });
  } catch {
    /* ignore */
  }
  router.replace("/login");
  router.refresh();
}

function NavList({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  const sections = (["main", "sales", "finance", "admin"] as const).map((s) => ({ s, list: items.filter((i) => i.section === s) })).filter((x) => x.list.length);
  const renderItem = (i: NavItem) => {
    const Icon = ICONS[i.icon] ?? House;
    const active = isActive(pathname, i.href);
    return (
      <li key={i.href}>
        <Link
          href={i.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cx(
            "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
            active ? "font-semibold" : "opacity-85 hover:opacity-100",
          )}
          style={active ? { background: "var(--nav-active)", boxShadow: "inset 2px 0 0 var(--gold)" } : undefined}
        >
          <Icon size={18} className={active ? "text-gold" : ""} aria-hidden />
          {i.label}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Main" className="space-y-5">
      {sections.map(({ s, list }) => (
        <div key={s}>
          <div className="px-3 pb-1.5 text-[0.68rem] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--nav-muted)" }}>
            {SECTION_LABEL[s]}
          </div>
          <ul className="space-y-0.5">
            {list.filter((i) => !i.group).map(renderItem)}
            {(["inventory", "staff", "organization", "uniklife", "settings"] as const).map((group) => {
              const grouped = list.filter((i) => i.group === group);
              if (!grouped.length) return null;
              return (
                <li key={group} className="list-none pt-2">
                  <div className="px-3 pb-1 text-[0.65rem] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--nav-muted)" }}>
                    {GROUP_LABEL[group]}
                  </div>
                  <ul className="space-y-0.5">{grouped.map(renderItem)}</ul>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppNav(p: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const home = p.isCustomer ? "/portal" : "/dashboard";
  const bottom = p.isCustomer
    ? [
        { href: "/portal", label: "Home", Icon: House },
        { href: "/ventures", label: "Ventures", Icon: Map },
        { href: "/bookings", label: "Bookings", Icon: ClipboardList },
      ]
    : [
        { href: "/dashboard", label: "Home", Icon: House },
        { href: "/ventures", label: "Ventures", Icon: Map },
        { href: "/bookings", label: "Bookings", Icon: ClipboardList },
        { href: "/notifications", label: "Alerts", Icon: Bell },
      ];

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="nav-surface fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/5 lg:flex">
        <div className="flex min-h-24 items-center px-5 py-4 [&_img]:!h-14 [&_img]:!max-w-[210px] [&_span>span:first-child]:!h-12 [&_span>span:first-child]:!w-12">
          <Link href={home}><BrandMark name={p.appName} logoUrl={p.logoUrl} logoWidth={p.logoWidth} logoHeight={p.logoHeight} /></Link>
        </div>
        <div className="gold-line mx-5 opacity-60" />
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList items={p.items} pathname={pathname} />
        </div>
        <div className="border-t border-white/10 p-4 text-sm">
          <div className="truncate font-semibold">{p.userName}</div>
          <div className="truncate text-xs" style={{ color: "var(--nav-muted)" }}>{p.roleLabel} · {p.orgName}</div>
          <button onClick={() => logout(router)} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold opacity-80 hover:opacity-100">
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Top bar (all sizes) */}
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-surface/85 px-2 backdrop-blur safe-top sm:h-14 sm:px-4 lg:ml-64 lg:h-16 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-surface-2"><Menu size={22} /></button>
          <Link href={home}><BrandMark name={p.appName} logoUrl={p.logoUrl} logoWidth={p.logoWidth} logoHeight={p.logoHeight} compact /></Link>
        </div>
        <div className="hidden text-sm text-muted lg:block">{p.orgName}</div>
        <div className="flex items-center gap-1 sm:gap-2">
          {!p.isCustomer && (
            <Link href="/notifications" aria-label={`Notifications (${p.unread} unread)`} className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-surface-2" data-testid="notif-bell">
              <Bell size={20} />
              {p.unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[0.65rem] font-bold text-[#1b1400]" data-testid="unread-count">
                  {p.unread > 99 ? "99+" : p.unread}
                </span>
              )}
            </Link>
          )}
          <span className="hidden text-sm font-semibold sm:inline">{p.userName}</span>
          {/* Light / Dark / Night switch — always the far top-right control. */}
          <ModeSwitcher variant="segmented" className="hidden lg:flex" />
          <ModeSwitcher compact className="lg:hidden [&>button]:h-10 [&>button]:w-10 [&>button]:justify-center [&>button]:border [&>button]:border-border" />
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="nav-surface absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col shadow-2xl safe-top">
            <div className="flex h-14 items-center justify-between px-4">
              <BrandMark name={p.appName} logoUrl={p.logoUrl} logoWidth={p.logoWidth} logoHeight={p.logoHeight} />
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-lg p-1.5"><X size={22} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <NavList items={p.items} pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-white/10 p-4 text-sm safe-bottom">
              <div className="font-semibold">{p.userName}</div>
              <div className="text-xs" style={{ color: "var(--nav-muted)" }}>{p.roleLabel}</div>
              <button onClick={() => logout(router)} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold"><LogOut size={14} /> Sign out</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom tab bar */}
      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-surface/95 backdrop-blur safe-bottom lg:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }}>
        {bottom.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} className={cx("relative flex flex-col items-center gap-0.5 py-2 text-[0.7rem] font-semibold", active ? "text-primary" : "text-muted")} aria-current={active ? "page" : undefined}>
              <Icon size={20} className={active ? "text-gold" : ""} />
              {label}
              {href === "/notifications" && p.unread > 0 && <span className="absolute right-[28%] top-1 h-2 w-2 rounded-full bg-gold" aria-hidden />}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[0.7rem] font-semibold text-muted">
          <Menu size={20} /> More
        </button>
      </nav>
    </>
  );
}
