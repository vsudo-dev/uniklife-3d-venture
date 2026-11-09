import { z } from "zod";

/**
 * Per-venture 3D viewer & presentation settings (ventures.viewer_settings jsonb).
 * Edited on the venture edit screen; consumed by the 3D viewer. Every field has a
 * safe default so older/empty rows keep working.
 */
export const BRAND_THEMES = [
  { id: "royal", name: "Royal Sapphire & Gold", primary: "#13308f", accent: "#c9a227" },
  { id: "midnight", name: "Midnight Royal", primary: "#4d6bff", accent: "#d9b443" },
  { id: "ivory", name: "Ivory Heritage", primary: "#1a3a9e", accent: "#b8901f" },
  { id: "emerald", name: "Emerald Estate", primary: "#0f6e4f", accent: "#c9a227" },
  { id: "ruby", name: "Ruby Prestige", primary: "#8f1d3a", accent: "#d4af37" },
  { id: "sapphire", name: "Ocean Sapphire", primary: "#0b5fa5", accent: "#e0b84f" },
  { id: "onyx", name: "Onyx & Gold", primary: "#1c1c22", accent: "#d4af37" },
  { id: "pearl", name: "Pearl Minimal", primary: "#3b4a6b", accent: "#b9975b" },
  { id: "saffron", name: "Saffron Sunrise", primary: "#b45309", accent: "#7c2d12" },
  { id: "teal", name: "Teal Horizon", primary: "#0f766e", accent: "#d4a73c" },
  { id: "amethyst", name: "Amethyst Royale", primary: "#5b21b6", accent: "#e0b84f" },
  { id: "copper", name: "Copper Earth", primary: "#7a3e1d", accent: "#c08a3e" },
] as const;
export type BrandThemeId = (typeof BRAND_THEMES)[number]["id"];
export const BRAND_THEME_IDS = BRAND_THEMES.map((t) => t.id) as [BrandThemeId, ...BrandThemeId[]];

export const COLOR_MODES = ["system", "light", "dark", "night"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const viewerSettingsSchema = z.object({
  referenceLayout:z.object({width:z.number().positive().max(20000),height:z.number().positive().max(20000),unitsPerPixel:z.number().positive().max(10)}).nullable().default(null),
  /** View the viewer opens in. */
  defaultMode: z.enum(["aerial", "intelligence", "top"]).default("aerial"),
  /** Visual rendering style. */
  renderStyle: z.enum(["realistic", "hologram"]).default("realistic"),
  /** Switch automatically between aerial and live plot intelligence when zooming. */
  autoTransition: z.boolean().default(true),
  /** Short descent into the aerial view on open (skipped for reduced motion). */
  introAnimation: z.boolean().default(true),
  /** Offer the cinematic tour. */
  tourEnabled: z.boolean().default(true),
  tourSpeed: z.number().min(0.5).max(2).default(1),
  /** Sky / lighting preset (illustrative only). */
  sky: z.enum(["day", "golden", "dusk", "night"]).default("golden"),
  /** Plot surface pattern in the cinematic view. */
  landPattern: z.enum(["earth", "sand", "lawn", "blueprint"]).default("earth"),
  showTrees: z.boolean().default(true),
  showStreetLights: z.boolean().default(true),
  showLabels: z.boolean().default(true),
  /** Tap behaviour: 'details' opens details first; 'cart' adds available plots straight to the booking selection. */
  tapAction: z.enum(["details", "cart"]).default("details"),
  /** Optional brand theme override for this venture's pages (null = organization theme). */
  themeOverride: z.enum(BRAND_THEME_IDS).nullable().default(null),
  /**
   * Custom opening camera (scene metres, layout centred at origin) saved by an admin
   * with "Save this view as opening view". null = computed from the venture's bounds.
   */
  customAerial: z
    .object({
      position: z.tuple([z.number(), z.number(), z.number()]),
      target: z.tuple([z.number(), z.number(), z.number()]),
    })
    .refine((p) => [...p.position, ...p.target].every((v) => Number.isFinite(v) && Math.abs(v) < 100_000), "Invalid camera pose")
    .refine((p) => p.position[1] > 0, "Camera must be above ground")
    .nullable()
    .default(null),
});
export type ViewerSettings = z.infer<typeof viewerSettingsSchema>;

export function parseViewerSettings(raw: unknown): ViewerSettings {
  const r = viewerSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : viewerSettingsSchema.parse({});
}

export const PROPERTY_TYPES = [
  { id: "open_plot", label: "Open plots" },
  { id: "villa_plot", label: "Villa / plot with construction" },
  { id: "apartment", label: "Apartments" },
  { id: "commercial", label: "Commercial" },
  { id: "farm_land", label: "Farm land" },
  { id: "mixed", label: "Mixed development" },
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number]["id"];
