import { ShieldAlert } from "lucide-react";
import { getAuthContext } from "@/lib/auth/server";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { Card, LinkButton } from "@/components/ui";

export const metadata = { title: "Access restricted" };

export default async function ForbiddenPage() {
  const ctx = await getAuthContext();
  const home = ctx?.role === "customer" ? "/portal" : "/dashboard";
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card className="relative overflow-hidden p-8 text-center">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-gold to-primary" aria-hidden />
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold-soft text-gold-strong">
          <ShieldAlert size={28} aria-hidden />
        </div>
        <div className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-gold">Error 403</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted">
          {ctx ? <>Your role ({ROLE_LABELS[ctx.role]}) in {ctx.organizationName} does not include this area.</> : "Your account does not include this area."} If you
          believe this is a mistake, ask your organization administrator to review your access.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <LinkButton href={home} variant="gold">Go to home</LinkButton>
          <LinkButton href="/settings" variant="outline">Account settings</LinkButton>
        </div>
      </Card>
    </div>
  );
}
