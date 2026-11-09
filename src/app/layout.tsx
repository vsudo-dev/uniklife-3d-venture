import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { getBranding } from "@/lib/auth/server";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { BRAND_THEMES, COLOR_MODES, type ColorMode } from "@/lib/viewer-settings";

// Urbanist is licensed under the SIL Open Font License (Google Fonts).
const urbanist = Urbanist({ subsets: ["latin"], variable: "--font-urbanist", display: "swap" });

export const dynamic = "force-dynamic";

const MODE_COOKIE = "ul_mode";

function themeColor(theme: string, mode: string) {
  if (mode === "night") return "#060504";
  if (mode === "dark") return "#070a14";
  return BRAND_THEMES.find((t) => t.id === theme)?.primary ?? "#0b1f5c";
}

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: { default: b.appName, template: `%s · ${b.appName}` },
    description: `${b.appName} — 3D venture explorer, plot booking and sales management.`,
    applicationName: b.appName,
    // Tenant-specific manifest (resolved from the request host); versioned to avoid cross-tenant cache reuse.
    manifest: `/manifest.webmanifest?v=${b.version}`,
    appleWebApp: { capable: true, title: b.shortName, statusBarStyle: "black-translucent" },
    icons: {
      icon: [{ url: `/api/pwa/icon/192?v=${b.version}`, sizes: "192x192", type: "image/png" }],
      apple: [{ url: `/api/pwa/icon/180?v=${b.version}`, sizes: "180x180", type: "image/png" }],
    },
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getBranding();
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: themeColor(b.theme, b.defaultColorMode) };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const b = await getBranding();
  const jar = await cookies();
  const cookieMode = jar.get(MODE_COOKIE)?.value;
  const preference: ColorMode = (COLOR_MODES as readonly string[]).includes(cookieMode ?? "") ? (cookieMode as ColorMode) : b.defaultColorMode;
  const ssrMode = preference === "system" ? "light" : preference;
  // Resolve "system" before first paint to avoid a light→dark flash.
  const script = `(function(){try{var p=${JSON.stringify(preference)};var m=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;document.documentElement.dataset.mode=m;}catch(e){}})();`;
  return (
    <html lang="en-IN" data-brand={b.theme} data-theme={b.theme} data-mode={ssrMode} data-mode-pref={preference} className={urbanist.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
