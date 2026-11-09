import "server-only";
import sharp from "sharp";
import type { Branding } from "@/lib/tenant";
import { BRAND_THEMES } from "@/lib/viewer-settings";

export const ICON_SIZES = [96, 180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

const STRONG: Partial<Record<Branding["theme"], string>> = { royal: "#0b1f5c", midnight: "#060b1d", ivory: "#faf7f0", onyx: "#111116" };
const THEME_BG = new Proxy({} as Record<Branding["theme"], string>, {
  get: (_t, key: string) => STRONG[key as Branding["theme"]] ?? BRAND_THEMES.find((b) => b.id === key)?.primary ?? "#0b1f5c",
});

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Default text-based icon (no third-party logo is recreated). Generated from our own SVG. */
function defaultIconSvg(size: number, label: string, theme: Branding["theme"]): string {
  const letter = escapeXml((label.trim()[0] ?? "U").toUpperCase());
  const bg = THEME_BG[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3dc8a"/><stop offset=".5" stop-color="#c9a227"/><stop offset="1" stop-color="#8f6d10"/></linearGradient></defs>
    <rect width="512" height="512" fill="${bg}"/>
    <circle cx="256" cy="256" r="170" fill="none" stroke="url(#g)" stroke-width="14"/>
    <text x="256" y="256" dy=".35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="190" fill="url(#g)">${letter}</text>
  </svg>`;
}

/**
 * Builds a square PNG icon. With an uploaded logo the logo is fitted INSIDE the
 * square (aspect ratio preserved, never cropped or distorted) on the theme
 * background; maskable icons get a larger safe-zone padding.
 */
export async function renderIcon(size: number, branding: Branding, logo: Buffer | null, maskable = false): Promise<Buffer> {
  const bg = THEME_BG[branding.theme];
  if (!logo) {
    return sharp(Buffer.from(defaultIconSvg(size, branding.shortName || branding.appName, branding.theme))).png().toBuffer();
  }
  const inner = Math.round(size * (maskable ? 0.6 : 0.8));
  const fitted = await sharp(logo, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: fitted, gravity: "center" }])
    .png()
    .toBuffer();
}

/** Validates an uploaded logo and returns normalized metadata. Rejects SVG (script risk) and oversized images. */
export async function inspectLogo(buf: Buffer): Promise<{ mime: string; width: number; height: number }> {
  if (buf.length > 5 * 1024 * 1024) throw new Error("Logo must be 5 MB or smaller");
  const meta = await sharp(buf, { limitInputPixels: 40_000_000 }).metadata();
  const fmt = meta.format;
  if (!fmt || !["png", "jpeg", "webp"].includes(fmt)) throw new Error("Logo must be a PNG, JPEG or WebP image");
  if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64) throw new Error("Logo must be at least 64×64 pixels");
  if (meta.width > 6000 || meta.height > 6000) throw new Error("Logo must be at most 6000×6000 pixels");
  return { mime: `image/${fmt}`, width: meta.width, height: meta.height };
}
