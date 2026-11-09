/**
 * Role & permission model. Enforced on the server in every service call;
 * the UI only uses it to hide controls the user cannot use.
 */

export const ORG_ROLES = ["org_admin", "venture_manager", "sales_manager", "sales_executive", "customer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export type Role = OrgRole | "platform_admin";
export const STAFF_ROLES: OrgRole[] = ["org_admin", "venture_manager", "sales_manager", "sales_executive"];

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: "Platform Administrator",
  org_admin: "Organization Administrator",
  venture_manager: "Venture Manager",
  sales_manager: "Sales Manager",
  sales_executive: "Sales Executive",
  customer: "Customer",
};

export const PERMISSIONS = [
  "platform.manage", // create/suspend organizations
  "org.manage", // organization profile & settings
  "staff.manage",
  "venture.view",
  "venture.create",
  "venture.update",
  "venture.delete",
  "plot.manage",
  "enquiry.view",
  "enquiry.manage",
  "booking.view",
  "booking.create", // place holds & booking requests on behalf of customers
  "booking.manage", // cancel, complete sale, release holds
  "booking.confirm", // confirm against staff-verified offline payments
  "discount.view",
  "discount.create",
  "discount.approve",
  "payment.view",
  "payment.record", // record & verify offline payments
  "dashboard.view",
  "integration.manage",
  "audit.view",
  "employee.view_all", // full directory (otherwise: own network only)
  "employee.manage", // create/edit employees, reporting lines, imports
  "attribution.manage", // reassign/correct sales attribution (with reason)
  "commission.plan_manage", // draft/submit commission plans, run simulator
  "commission.approve", // approve plans, ledger entries and settlements
  "commission.settle", // build settlements, request finance, confirm payment
  "site_visit.manage",
  "branding.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_ORG: Permission[] = PERMISSIONS.filter((p) => p !== "platform.manage");

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  platform_admin: PERMISSIONS,
  org_admin: ALL_ORG,
  venture_manager: [
    "venture.view", "venture.update", "plot.manage",
    "enquiry.view", "booking.view", "booking.manage",
    "discount.view", "discount.approve", "payment.view", "dashboard.view", "site_visit.manage",
  ],
  sales_manager: [
    "venture.view", "enquiry.view", "enquiry.manage",
    "booking.view", "booking.create", "booking.manage", "booking.confirm",
    "discount.view", "discount.create", "discount.approve",
    "payment.view", "payment.record", "dashboard.view", "audit.view",
    "attribution.manage", "site_visit.manage",
  ],
  sales_executive: [
    "venture.view", "enquiry.view", "enquiry.manage",
    "booking.view", "booking.create", "discount.view", "payment.view", "site_visit.manage",
  ],
  customer: [],
};

/**
 * Roles that see organization-wide operational records (bookings, enquiries, site
 * visits). Everyone else is limited to their own network (self + descendants).
 */
export function hasOrgWideRecordScope(role: Role): boolean {
  return role === "platform_admin" || role === "org_admin" || role === "venture_manager";
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHas(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

/** Roles whose venture access is limited to explicit venture assignments. */
export function isVentureScopedRole(role: Role): boolean {
  return role === "venture_manager" || role === "sales_executive";
}

/** Which roles a given role may grant to staff members. */
export function assignableRoles(role: Role): OrgRole[] {
  if (role === "platform_admin" || role === "org_admin") return ["org_admin", "venture_manager", "sales_manager", "sales_executive"];
  return [];
}

/**
 * Discount authority: the maximum percentage-equivalent discount a role may
 * activate without separate approval. Values above the organization's approval
 * threshold always require approval by someone holding discount.approve.
 */
export function canSelfApproveDiscount(role: Role): boolean {
  return role === "platform_admin" || role === "org_admin";
}
