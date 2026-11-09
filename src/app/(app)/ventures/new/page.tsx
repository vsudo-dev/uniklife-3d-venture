import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui";
import { VentureForm } from "@/components/ventures/venture-form";

export const metadata = { title: "New venture" };

export default async function NewVenturePage() {
  await requirePageContext("venture.create");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={<Link href="/ventures" className="hover:underline">Ventures</Link>}
        title="New venture"
        subtitle="Create the venture with its layout PDF and optional inventory CSV, then review the extracted plots."
      />
      <VentureForm mode="create" />
    </div>
  );
}
