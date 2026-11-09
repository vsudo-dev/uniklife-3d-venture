import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { listManagerOptions, listVentureOptions } from "@/lib/services/employees";
import { PageHeader } from "@/components/ui";
import { EMPTY_EMPLOYEE, EmployeeForm } from "@/components/admin/employee-form";

export const metadata = { title: "New employee" };
export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  const ctx = await requirePageContext("employee.manage");
  const [managers, ventures] = await Promise.all([listManagerOptions(ctx), listVentureOptions(ctx)]);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/employees" className="hover:underline">Employees</Link>}
        title="Add employee"
        subtitle="To give this person a login, create them from Staff & access instead — that creates the user and the linked employee record together."
      />
      <div className="max-w-4xl">
        <EmployeeForm initial={EMPTY_EMPLOYEE} managers={managers} ventures={ventures} />
      </div>
    </>
  );
}
