import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor } from "../support/db";
import { AppError } from "@/lib/errors";
import {
  commitEmployeeImport, createEmployee, getEmployee, listEmployees, previewEmployeeImport, updateEmployee, type EmployeeInput,
} from "@/lib/services/employees";
import { changeStaffRole, createStaff, listStaff, resetStaffPassword, setStaffStatus } from "@/lib/services/staff";
import { listAuditLogs, exportAuditCsv } from "@/lib/services/audit-log";
import { createNotification, listMyNotifications, markRead, unreadCount } from "@/lib/services/notifications";
import { createOrganization, resolveSwitchTarget, setOrganizationStatus } from "@/lib/services/organizations";

let db: Database;
let orgA: string;
let ceoEmployeeId: string;

const base = (over: Partial<EmployeeInput> = {}): EmployeeInput => ({
  fullName: "Test Person", mobile: null, email: null, designation: "Sales Executive", commissionLevel: 8, commissionEligible: true,
  reportingManagerId: null, employmentStatus: "active", joiningDate: null, ventureIds: [], hrmReference: null, ...over,
});

async function expectAppError(p: Promise<unknown>, status: number) {
  const e = await p.then(() => null, (err) => err);
  expect(e, "expected the call to fail").toBeInstanceOf(AppError);
  expect((e as AppError).status).toBe(status);
  return e as AppError;
}

beforeAll(async () => {
  db = await createTestDb();
  const [o] = await db.query<{ id: string }>("select id from organizations where slug = 'demo-ventures'");
  orgA = o.id;
  const [e] = await db.query<{ id: string }>("select id from employees where organization_id = $1 and employee_code = 'EMP-00118'", [orgA]);
  ceoEmployeeId = e.id;
});

describe("employee directory", () => {
  it("allocates unique, well-formed employee IDs under concurrency", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const rows = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createEmployee(ceo, base({ fullName: `Concurrent ${i}`, reportingManagerId: ceoEmployeeId }))),
    );
    const codes = rows.map((r) => String(r.employee_code));
    expect(new Set(codes).size).toBe(6);
    for (const c of codes) expect(c).toMatch(/^EMP-\d{5}$/);
    const [{ n }] = await db.query<{ n: number }>(
      "select count(*)::int as n from (select employee_code from employees where organization_id = $1 group by employee_code having count(*) > 1) d",
      [orgA],
    );
    expect(n).toBe(0);
  });

  it("rejects reporting cycles and self-reporting", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const a = await createEmployee(ceo, base({ fullName: "Cycle A", reportingManagerId: ceoEmployeeId }));
    const b = await createEmployee(ceo, base({ fullName: "Cycle B", reportingManagerId: String(a.id) }));
    await expectAppError(updateEmployee(ceo, String(a.id), base({ fullName: "Cycle A", reportingManagerId: String(b.id) })), 400);
    await expectAppError(updateEmployee(ceo, String(a.id), base({ fullName: "Cycle A", reportingManagerId: String(a.id) })), 400);
    const [row] = await db.query<{ reporting_manager_id: string }>("select reporting_manager_id from employees where id = $1", [a.id]);
    expect(row.reporting_manager_id).toBe(ceoEmployeeId);
  });

  it("import preview flags duplicates and missing managers; commit requires an org admin", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const csv = [
      "full_name,mobile,email,designation,commission_level,manager_ref,hrm_reference,joining_date",
      "Import One,+919700000001,one@example.com,Sales Executive,5,EMP-00118,HRM-1,2024-01-01",
      "Import Dup,+919700000002,dup@example.com,Sales Executive,6,HRM-1,HRM-1,2024-01-01",
      "Import Orphan,+919700000003,,Sales Executive,6,NOPE-999,HRM-3,",
      "Import Mobile,+91 98500 11111,,Sales Executive,6,,HRM-4,",
      "Import Two,+919700000005,,Sales Executive,13,HRM-1,HRM-5,01/02/2024", // levels are 1-12
    ].join("\n");
    const p = await previewEmployeeImport(ceo, csv);
    expect(p.rows).toHaveLength(5);
    expect(p.rows[0].errors).toEqual([]);
    expect(p.rows[1].errors.join(" ")).toMatch(/duplicate hrm_reference/);
    expect(p.rows[2].errors.join(" ")).toMatch(/manager_ref not found/);
    expect(p.rows[3].errors.join(" ")).toMatch(/mobile already exists/);
    expect(p.rows[4].errors.join(" ")).toMatch(/commission_level/);
    expect(p.rows[4].errors.join(" ")).toMatch(/joining_date/);
    expect(p.invalid).toBe(4);

    // Invalid file cannot be committed even by an admin.
    await expectAppError(commitEmployeeImport(ceo, csv), 400);

    const good = [
      "full_name,mobile,email,designation,commission_level,manager_ref,hrm_reference,joining_date",
      "Good One,+919700000101,,Sales Manager,5,EMP-00118,HRM-G1,2024-02-01",
      "Good Two,+919700000102,,Sales Executive,6,HRM-G1,HRM-G2,2024-02-02",
    ].join("\n");
    const lakshmi = await ctxFor(db, "lakshmi@demo.local"); // sales_manager
    await expectAppError(commitEmployeeImport(lakshmi, good), 403);
    const res = await commitEmployeeImport(ceo, good);
    expect(res.created).toHaveLength(2);
    const [g2] = await db.query<{ mgr: string }>(
      "select m.hrm_reference as mgr from employees e join employees m on m.id = e.reporting_manager_id where e.hrm_reference = 'HRM-G2' and e.organization_id = $1",
      [orgA],
    );
    expect(g2.mgr).toBe("HRM-G1");
  });

  it("limits sales executives to their own network and blocks staff management", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const list = await listEmployees(anil);
    expect(list.map((e) => e.employee_code)).toEqual(["EMP-00125"]);
    await expectAppError(getEmployee(anil, ceoEmployeeId), 404);
    await expectAppError(previewEmployeeImport(anil, "full_name\nX Y"), 403);
    await expectAppError(listStaff(anil), 403);
    await expectAppError(
      createStaff(anil, { email: "x@example.com", fullName: "Nope", role: "sales_executive", temporaryPassword: "Strong12345", phone: null, employee: null }),
      403,
    );
    const ceo = await ctxFor(db, "ceo@demo.local");
    expect((await listEmployees(ceo)).length).toBeGreaterThan(8);
  });
});

describe("staff & access", () => {
  it("creates a staff user with a linked employee in one transaction and enforces role/password rules", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    await expectAppError(
      createStaff(ceo, { email: "weak@example.com", fullName: "Weak", role: "sales_executive", temporaryPassword: "short", phone: null, employee: null }).catch((e) => {
        throw e instanceof AppError ? e : new AppError(400, "validation_error", String(e));
      }),
      400,
    );
    const res = await createStaff(ceo, {
      email: "new.exec@example.com", fullName: "New Exec", role: "sales_executive", temporaryPassword: "Welcome12345", phone: null,
      employee: { designation: "Sales Executive", commissionLevel: 8, reportingManagerId: ceoEmployeeId, joiningDate: null, ventureIds: [] },
    });
    expect(res.employeeCode).toMatch(/^EMP-\d{5}$/);
    const [link] = await db.query<{ user_id: string }>("select user_id from employees where employee_code = $1 and organization_id = $2", [res.employeeCode, orgA]);
    expect(link.user_id).toBe(res.userId);
    // Duplicate email is a conflict and leaves nothing behind.
    await expectAppError(
      createStaff(ceo, { email: "NEW.EXEC@example.com", fullName: "Dup", role: "sales_executive", temporaryPassword: "Welcome12345", phone: null, employee: null }),
      409,
    );
    // Linked-employee failure rolls back the user too.
    await expectAppError(
      createStaff(ceo, {
        email: "rollback@example.com", fullName: "Rollback", role: "sales_executive", temporaryPassword: "Welcome12345", phone: null,
        employee: { designation: null, commissionLevel: null, reportingManagerId: "00000000-0000-4000-8000-000000000000", joiningDate: null, ventureIds: [] },
      }),
      400,
    );
    const [ghost] = await db.query("select 1 from app_users where email = 'rollback@example.com'");
    expect(ghost).toBeUndefined();

    const exec = (await listStaff(ceo)).find((m) => m.email === "new.exec@example.com")!;
    await changeStaffRole(ceo, exec.member_id, "sales_manager");
    await resetStaffPassword(ceo, exec.member_id, "Another12345");
    await expectAppError(resetStaffPassword(ceo, exec.member_id, "weak"), 400);
    await setStaffStatus(ceo, exec.member_id, "disabled");
    await setStaffStatus(ceo, exec.member_id, "active");
  });

  it("cannot disable yourself or the last org admin", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const staff = await listStaff(ceo);
    const self = staff.find((m) => m.email === "ceo@demo.local")!;
    await expectAppError(setStaffStatus(ceo, self.member_id, "disabled"), 409);

    const platform = await ctxFor(db, "platform@uniklife.local", orgA);
    expect(platform.role).toBe("platform_admin");
    await expectAppError(setStaffStatus(platform, self.member_id, "disabled"), 409);
    await expectAppError(changeStaffRole(platform, self.member_id, "sales_manager"), 409);

    // With a second admin, the first can be demoted.
    const second = await createStaff(ceo, { email: "admin2@example.com", fullName: "Second Admin", role: "org_admin", temporaryPassword: "Welcome12345", phone: null, employee: null });
    await setStaffStatus(platform, second.memberId, "disabled");
    await expectAppError(setStaffStatus(platform, self.member_id, "disabled"), 409);
    await setStaffStatus(platform, second.memberId, "active");
    await setStaffStatus(platform, self.member_id, "disabled");
    await setStaffStatus(platform, self.member_id, "active");
  });

  it("org admins cannot reset passwords of accounts shared with another organization", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const bAdmin = await ctxFor(db, "admin@sample-b.local");
    const [u] = await db.query<{ id: string }>("select id from app_users where email = 'priya@demo.local'");
    await db.query("insert into organization_members (organization_id, user_id, role) values ($1,$2,'sales_executive')", [bAdmin.organizationId, u.id]);
    const priya = (await listStaff(ceo)).find((m) => m.email === "priya@demo.local")!;
    await expectAppError(resetStaffPassword(ceo, priya.member_id, "Takeover12345"), 403);
    // And org B cannot touch org A memberships at all.
    await expectAppError(setStaffStatus(bAdmin, priya.member_id, "disabled"), 404);
  });
});

describe("tenant isolation", () => {
  it("org B admin cannot see org A employees or audit logs", async () => {
    const bAdmin = await ctxFor(db, "admin@sample-b.local");
    expect(bAdmin.organizationId).not.toBe(orgA);
    const list = await listEmployees(bAdmin);
    expect(list.every((e) => !e.employee_code || e.id !== ceoEmployeeId)).toBe(true);
    const aIds = new Set((await db.query<{ id: string }>("select id from employees where organization_id = $1", [orgA])).map((r) => r.id));
    expect(list.some((e) => aIds.has(e.id))).toBe(false);
    await expectAppError(getEmployee(bAdmin, ceoEmployeeId), 404);

    const aAudit = new Set((await db.query<{ id: string }>("select id from audit_logs where organization_id = $1", [orgA])).map((r) => r.id));
    expect(aAudit.size).toBeGreaterThan(0);
    const bLogs = await listAuditLogs(bAdmin, { pageSize: 200 });
    expect(bLogs.rows.some((r) => aAudit.has(r.id))).toBe(false);
    const csv = await exportAuditCsv(bAdmin, {});
    expect(csv.csv).not.toContain("ceo@demo.local");

    const ceo = await ctxFor(db, "ceo@demo.local");
    const aLogs = await listAuditLogs(ceo, { entityType: "employee", pageSize: 10 });
    expect(aLogs.total).toBeGreaterThan(0);
    expect(aLogs.rows.every((r) => r.entity_type === "employee")).toBe(true);
    const anil = await ctxFor(db, "anil@demo.local");
    await expectAppError(listAuditLogs(anil), 403);
  });

  it("only platform admins manage organizations; members switch only to their own orgs", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    await expectAppError(
      createOrganization(ceo, { name: "Nope Org", slug: "nope-org", adminEmail: "nope@example.com", adminName: "Nope", adminPassword: "Welcome12345", contactEmail: null }),
      403,
    );
    const platform = await ctxFor(db, "platform@uniklife.local");
    const created = await createOrganization(platform, {
      name: "Gamma Estates", slug: "gamma-estates", adminEmail: "admin@gamma.example", adminName: "Gamma Admin", adminPassword: "Welcome12345", contactEmail: null,
    });
    expect(created.adminEmployeeCode).toBe("EMP-00001");
    const gamma = await ctxFor(db, "admin@gamma.example");
    expect(gamma.role).toBe("org_admin");
    expect(gamma.employee?.commissionLevel).toBe(1);
    await expectAppError(resolveSwitchTarget(gamma, orgA), 403);
    expect(await resolveSwitchTarget(platform, created.id)).toBe(created.id);
    await setOrganizationStatus(platform, created.id, "suspended");
    await expectAppError(ctxFor(db, "admin@gamma.example"), 403);
    await setOrganizationStatus(platform, created.id, "active");
  });
});

describe("notifications", () => {
  it("are scoped to the recipient", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const vikram = await ctxFor(db, "vikram@demo.local");
    const id = await db.transaction((q) =>
      createNotification(q, { organizationId: orgA, recipientUserId: anil.user.id, type: "system", title: "Private", body: "For Anil only", plotNumbers: ["7"], link: "/bookings" }),
    );
    expect(id).toBeTruthy();
    const before = await unreadCount(anil);
    await markRead(vikram, [id!]);
    expect(await unreadCount(anil)).toBe(before);
    expect((await listMyNotifications(vikram)).some((n) => n.id === id)).toBe(false);
    expect((await listMyNotifications(anil, { type: "system", unreadOnly: true })).some((n) => n.id === id)).toBe(true);
    await markRead(anil, [id!]);
    expect(await unreadCount(anil)).toBe(before - 1);
  });
});
