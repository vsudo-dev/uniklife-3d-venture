import { redirect } from "next/navigation";
import { getAuthContext, getBranding } from "@/lib/auth/server";
import { BrandMark } from "@/components/ui";
import { env } from "@/lib/env";
import { LoginForm } from "./login-form";
import { ModeSwitcher } from "@/components/theme/mode-switcher";

export const metadata = { title: "Sign in" };

const DEMO = [
  { label: "Platform admin", email: "platform@uniklife.local" },
  { label: "CEO / Org admin (L1)", email: "ceo@demo.local" },
  { label: "Sales manager (L4)", email: "lakshmi@demo.local" },
  { label: "Sales exec (L7)", email: "vikram@demo.local" },
  { label: "Sales exec (L8, EMP-00125)", email: "anil@demo.local" },
  { label: "Parallel team (L5)", email: "deepa@demo.local" },
  { label: "Venture manager", email: "venture.manager@demo.local" },
  { label: "Customer", email: "customer@demo.local" },
];

export default async function LoginPage() {
  const ctx = await getAuthContext();
  if (ctx) redirect(ctx.role === "customer" ? "/portal" : "/dashboard");
  const b = await getBranding();
  const localDemo = env.NODE_ENV !== "production" && env.DATABASE_DRIVER === "pglite" && env.AUTO_SEED_DEMO;
  // Hosted TEST environments may opt in to listing the (fictional) demo accounts.
  const testEnv = env.SHOW_TEST_ACCOUNTS && !!env.TEST_ACCOUNTS_PASSWORD;
  const showDemo = localDemo || testEnv;
  const demoPassword = testEnv ? env.TEST_ACCOUNTS_PASSWORD! : "Demo@12345";

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="premium-hero relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10"><BrandMark name={b.appName} logoUrl={b.logoUrl} logoWidth={b.logoWidth} logoHeight={b.logoHeight} /></div>
        <div className="relative z-10 max-w-lg">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-[#e9cf73]">Venture · Plots · Bookings</div>
          <h1 className="text-4xl font-extrabold leading-tight">
            Explore ventures in 3D. <span className="gold-text">Book with confidence.</span>
          </h1>
          <p className="mt-4 text-base text-white/75">
            Live plot availability, server-verified bookings and payments, discount controls, team commissions and real-time notifications — in one workspace.
          </p>
        </div>
        {/* Decorative isometric plot grid */}
        <svg className="absolute -right-24 bottom-0 w-[620px] opacity-50" viewBox="0 0 600 400" aria-hidden>
          {Array.from({ length: 6 }).map((_, r) =>
            Array.from({ length: 8 }).map((__, c) => {
              const x = 300 + (c - r) * 34;
              const y = 120 + (c + r) * 18;
              const colors = ["#16a34a", "#16a34a", "#16a34a", "#eab308", "#2563eb", "#dc2626", "#16a34a", "#f97316"];
              return <polygon key={`${r}-${c}`} points={`${x},${y} ${x + 32},${y + 17} ${x},${y + 34} ${x - 32},${y + 17}`} fill={colors[(r * 3 + c) % colors.length]} fillOpacity={0.55} stroke="#e9cf73" strokeOpacity={0.35} />;
            }),
          )}
        </svg>
        <div className="relative z-10 text-xs text-white/50">© {new Date().getFullYear()} {b.companyName}</div>
      </section>
      <section className="relative flex items-center justify-center px-5 py-10">
        <ModeSwitcher variant="segmented" className="absolute right-4 top-4 hidden sm:flex" />
        <ModeSwitcher compact className="absolute right-3 top-3 sm:hidden" />
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><BrandMark name={b.appName} logoUrl={b.logoUrl} logoWidth={b.logoWidth} logoHeight={b.logoHeight} /></div>
          <h2 className="text-2xl font-extrabold">Welcome back</h2>
          <p className="mb-6 mt-1 text-sm text-muted">Sign in to {b.appName}</p>
          <LoginForm demoAccounts={showDemo ? DEMO : null} demoPassword={demoPassword} testEnvironment={testEnv} />
        </div>
      </section>
    </main>
  );
}
