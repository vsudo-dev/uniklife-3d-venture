import type { Permission, Role } from "@/lib/auth/permissions";
import { roleHas } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name, resolved in the client nav
  permission?: Permission;
  staffOnly?: boolean;
  customerOnly?: boolean;
  platformOnly?: boolean;
  group?: "inventory" | "staff" | "organization" | "uniklife" | "settings";
  section: "main" | "sales" | "finance" | "admin";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home", staffOnly: true, section: "main" },
  { href: "/portal", label: "My portal", icon: "home", customerOnly: true, section: "main" },
  { href: "/ventures", label: "Ventures", icon: "map", group: "inventory", section: "sales" },
  { href: "/plots", label: "Plot inventory", icon: "grid", permission: "venture.view", group: "inventory", section: "sales" },
  { href: "/bookings", label: "Bookings", icon: "clipboard", section: "sales" },
  { href: "/enquiries", label: "Enquiries", icon: "inbox", permission: "enquiry.view", section: "sales" },
  { href: "/site-visits", label: "Site visits", icon: "calendar", staffOnly: true, section: "sales" },
  { href: "/site-visits/tracking", label: "Trip tracking", icon: "activity", staffOnly: true, section: "sales" },
  { href: "/network", label: "My network", icon: "network", staffOnly: true, section: "sales" },
  { href: "/sales", label: "Sales dashboard", icon: "chart", permission: "dashboard.view", section: "sales" },
  { href: "/commissions/plans?section=discounts", label: "Plans & simulator", icon: "tag", permission: "discount.view", section: "finance" },
  { href: "/payments", label: "Payments", icon: "card", permission: "payment.view", section: "finance" },
  { href: "/commissions", label: "Commission Structure", icon: "coins", staffOnly: true, section: "finance" },
  { href: "/staff", label: "Staff & Access", icon: "users", permission: "staff.manage", group: "organization", section: "admin" },
  { href: "/organizations", label: "Organizations", icon: "building", platformOnly: true, group: "organization", section: "admin" },
  { href: "/integrations", label: "Uniklife AI Integration", icon: "plug", permission: "integration.manage", group: "uniklife", section: "admin" },
  { href: "/settings", label: "Settings", icon: "settings", group: "settings", section: "admin" },
];

export function visibleNav(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => {
    if (i.platformOnly) return role === "platform_admin";
    if (i.customerOnly) return role === "customer";
    if (i.staffOnly && role === "customer") return false;
    if (i.permission && !roleHas(role, i.permission)) return false;
    if (role === "customer" && !["/portal", "/ventures", "/bookings", "/settings"].includes(i.href)) return false;
    return true;
  });
}
