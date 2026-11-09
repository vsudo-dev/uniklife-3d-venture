import type { Branding } from "@/lib/tenant";
import { BRAND_THEMES } from "@/lib/viewer-settings";

/**
 * Builds the Web App Manifest for one tenant. The manifest `id` is tenant-specific so
 * that two white-label apps on different domains are distinct installs; the scope is
 * the tenant's own origin (manifest scope cannot span origins).
 */
export function buildManifest(b: Branding) {
  const themeColor =
    b.theme === "ivory" ? "#faf7f0" : b.theme === "midnight" ? "#060b1d" : (BRAND_THEMES.find((t) => t.id === b.theme)?.primary ?? "#0b1f5c");
  const v = b.version;
  return {
    id: `/?app=${b.organizationId ?? "platform"}`,
    name: b.appName,
    short_name: b.shortName,
    description: `${b.appName} — venture explorer, plot booking and sales workspace`,
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: themeColor,
    theme_color: themeColor,
    lang: "en-IN",
    categories: ["business", "productivity"],
    icons: [
      { src: `/api/pwa/icon/192?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/api/pwa/icon/512?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/api/pwa/icon/512?maskable=1&v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Notifications", url: "/notifications", icons: [{ src: `/api/pwa/icon/96?v=${v}`, sizes: "96x96" }] },
      { name: "Bookings", url: "/bookings", icons: [{ src: `/api/pwa/icon/96?v=${v}`, sizes: "96x96" }] },
    ],
  };
}

/** Minimal installability checks used by tests and the branding screen. */
export function validateManifest(m: ReturnType<typeof buildManifest>): string[] {
  const errors: string[] = [];
  if (!m.name || !m.short_name) errors.push("name and short_name are required");
  if (m.short_name.length > 12) errors.push("short_name should be 12 characters or fewer");
  if (!["standalone", "fullscreen", "minimal-ui"].includes(m.display)) errors.push("display must be standalone/fullscreen/minimal-ui");
  if (!m.start_url.startsWith("/")) errors.push("start_url must be same-origin");
  const sizes = new Set(m.icons.filter((i) => i.purpose === "any").map((i) => i.sizes));
  if (!sizes.has("192x192") || !sizes.has("512x512")) errors.push("192px and 512px icons are required");
  if (!m.icons.some((i) => i.purpose === "maskable")) errors.push("a maskable icon is recommended");
  return errors;
}
