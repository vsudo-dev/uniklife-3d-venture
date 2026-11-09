import type { Queryable } from "@/lib/db/types";
import { BRAND_THEME_IDS, COLOR_MODES, type BrandThemeId, type ColorMode } from "@/lib/viewer-settings";

export type ThemeName = BrandThemeId;

export interface Branding {
  organizationId: string | null;
  companyName: string;
  appName: string;
  shortName: string;
  theme: ThemeName;
  defaultColorMode: ColorMode;
  logoUrl: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  version: number;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
}

/** Platform default branding — a temporary TEXT brand mark (no logo is recreated). */
export const PLATFORM_BRANDING: Branding = {
  organizationId: null,
  companyName: "UNIKLIFE.AI",
  appName: "UNIKLIFE 3D Venture",
  shortName: "UL Venture",
  theme: "royal",
  defaultColorMode: "system",
  logoUrl: null,
  logoWidth: null,
  logoHeight: null,
  version: 1,
  contactEmail: null,
  contactPhone: null,
  website: null,
};

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/\.$/, "");
}

export async function findOrganizationByHost(q: Queryable, host: string): Promise<string | null> {
  const h = normalizeHost(host);
  if (!h) return null;
  const [row] = await q.query<{ organization_id: string }>(
    `select d.organization_id from organization_domains d join organizations o on o.id = d.organization_id
      where lower(d.domain) = $1 and d.verified and o.status = 'active'`,
    [h],
  );
  return row?.organization_id ?? null;
}

export async function loadBranding(q: Queryable, orgId: string | null): Promise<Branding> {
  if (!orgId) return PLATFORM_BRANDING;
  const [o] = await q.query<Record<string, unknown>>(
    `select id, name, app_name, short_name, theme, default_color_mode, logo_path, logo_width, logo_height, branding_version, contact_email, contact_phone, website
       from organizations where id = $1`,
    [orgId],
  );
  if (!o) return PLATFORM_BRANDING;
  const version = Number(o.branding_version ?? 1);
  const appName = (o.app_name as string) || String(o.name);
  return {
    organizationId: String(o.id),
    companyName: String(o.name),
    appName,
    shortName: (o.short_name as string) || appName.slice(0, 12),
    theme: (BRAND_THEME_IDS as readonly string[]).includes(String(o.theme)) ? (o.theme as ThemeName) : "royal",
    defaultColorMode: (COLOR_MODES as readonly string[]).includes(String(o.default_color_mode)) ? (o.default_color_mode as ColorMode) : "system",
    logoUrl: o.logo_path ? `/api/branding/${o.id}/logo?v=${version}` : null,
    logoWidth: (o.logo_width as number) ?? null,
    logoHeight: (o.logo_height as number) ?? null,
    version,
    contactEmail: (o.contact_email as string) ?? null,
    contactPhone: (o.contact_phone as string) ?? null,
    website: (o.website as string) ?? null,
  };
}
