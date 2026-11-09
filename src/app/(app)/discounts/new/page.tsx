import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { canSelfApproveDiscount } from "@/lib/auth/permissions";
import { discountDashboard } from "@/lib/services/discounts";
import { PageHeader } from "@/components/ui";
import { DiscountForm } from "@/components/discounts/discount-form";
import { EMPTY_DISCOUNT } from "@/components/discounts/discount-values";

export const metadata = { title: "New discount" };

export default async function NewDiscountPage() {
  const ctx = await requirePageContext("discount.create");
  const { settings } = await discountDashboard(ctx);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/discounts" className="hover:underline">Discounts</Link>}
        title="New discount"
        subtitle="The server checks organization limits and your approval authority before the discount can be used."
      />
      <DiscountForm mode="create" initial={EMPTY_DISCOUNT} settings={settings} canSelfApprove={canSelfApproveDiscount(ctx.role)} />
    </>
  );
}
