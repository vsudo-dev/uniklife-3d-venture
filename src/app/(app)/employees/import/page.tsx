import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui";
import { EmployeeImport } from "@/components/admin/employee-import";

export const metadata = { title: "Import employees" };

export default async function EmployeeImportPage() {
  const ctx = await requirePageContext("employee.manage");
  return (
    <>
      <PageHeader eyebrow={<Link href="/employees" className="hover:underline">Employees</Link>} title="Import employees" />
      <div className="max-w-6xl">
        <EmployeeImport canApprove={ctx.role === "org_admin" || ctx.role === "platform_admin"} />
      </div>
    </>
  );
}
