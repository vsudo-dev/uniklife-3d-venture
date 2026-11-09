import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext, getBranding, getHostTenant } from "@/lib/auth/server";
import { BrandMark, Notice } from "@/components/ui";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  const ctx = await getAuthContext();
  if (ctx) redirect(ctx.role === "customer" ? "/portal" : "/dashboard");
  const tenant = await getHostTenant();
  const b = await getBranding();

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="premium-hero relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10"><BrandMark name={b.appName} logoUrl={b.logoUrl} logoWidth={b.logoWidth} logoHeight={b.logoHeight} /></div>
        <div className="relative z-10 max-w-lg">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-[#e9cf73]">Customer account</div>
          <h1 className="text-4xl font-extrabold leading-tight">
            Find your plot in 3D. <span className="gold-text">Book it securely.</span>
          </h1>
          <p className="mt-4 text-base text-white/75">
            Explore live availability, request a site visit, book one or more plots and track your payments — all in one place.
          </p>
        </div>
        <div className="relative z-10 text-xs text-white/50">© {new Date().getFullYear()} {b.companyName}</div>
      </section>
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><BrandMark name={b.appName} logoUrl={b.logoUrl} logoWidth={b.logoWidth} logoHeight={b.logoHeight} /></div>
          <h2 className="text-2xl font-extrabold">Create your account</h2>
          {tenant ? (
            <>
              <p className="mb-6 mt-1 text-sm text-muted">Register as a customer of {b.companyName}</p>
              <SignupForm />
            </>
          ) : (
            <div className="mt-4">
              <Notice tone="gold" title="Registration link required">
                Please use your developer&apos;s app link to register. Customer accounts are created on the developer&apos;s own branded app address.
              </Notice>
            </div>
          )}
          <p className="mt-6 text-center text-sm text-muted">
            Already have an account? <Link href="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
