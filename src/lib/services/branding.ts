import { z } from "zod";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { isPgError, type Queryable } from "@/lib/db/types";
import { inspectLogo } from "@/lib/pwa/icons";
import { buildObjectPath, getObject, putObject, sniffType } from "@/lib/storage";
import { normalizeHost, type ThemeName } from "@/lib/tenant";
import { BRAND_THEMES, BRAND_THEME_IDS, COLOR_MODES, type ColorMode } from "@/lib/viewer-settings";
import { db, isUuid, withTx } from "./common";

// ---------------------------------------------------------------------------
// White-label branding (branding.manage). Uploaded logos are stored EXACTLY as
// uploaded (byte-for-byte); PWA icons are generated from them on demand.
// ---------------------------------------------------------------------------

/** Every selectable brand theme (single source of truth: BRAND_THEMES in @/lib/viewer-settings). */
export const THEMES: { id: ThemeName; label: string; primary: string; accent: string; swatches: string[] }[] = BRAND_THEMES.map((t) => ({
  id: t.id, label: t.name, primary: t.primary, accent: t.accent, swatches: [t.primary, t.accent],
}));

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().or(z.literal("").transform(() => null));

export const brandingInputSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  appName: z.string().trim().min(2).max(60),
  shortName: z.string().trim().min(1, "Short name is required").max(12, "Short name must be 12 characters or fewer"),
  theme: z.enum(BRAND_THEME_IDS),
  /** Default light/dark/night mode for users who have not chosen one. Omitted = unchanged. */
  defaultColorMode: z.enum(COLOR_MODES).optional(),
  website: z.string().trim().url().max(200).refine((u) => /^https?:\/\//i.test(u), "Website must start with http(s)://").optional().nullable().or(z.literal("").transform(() => null)),
  contactEmail: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  contactPhone: optionalText(40),
});
export type BrandingInput = z.infer<typeof brandingInputSchema>;

export interface BrandingSettings {
  organizationId: string;
  companyName: string;
  appName: string;
  shortName: string;
  theme: ThemeName;
  defaultColorMode: ColorMode;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  logoMime: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  brandingVersion: number;
}

export async function getBrandingSettings(ctx: AuthContext): Promise<BrandingSettings> {
  assertPermission(ctx, "branding.manage");
  const q = await db();
  const [o] = await q.query<Record<string, unknown>>(
    `select id, name, app_name, short_name, theme, default_color_mode, website, contact_email, contact_phone, logo_path, logo_mime, logo_width, logo_height, branding_version
       from organizations where id = $1`,
    [ctx.organizationId],
  );
  if (!o) throw notFound("Organization");
  const version = Number(o.branding_version ?? 1);
  return {
    organizationId: String(o.id),
    companyName: String(o.name),
    appName: (o.app_name as string) || String(o.name),
    shortName: (o.short_name as string) || ((o.app_name as string) || String(o.name)).slice(0, 12),
    theme: (BRAND_THEME_IDS as readonly string[]).includes(String(o.theme)) ? (o.theme as ThemeName) : "royal",
    defaultColorMode: (COLOR_MODES as readonly string[]).includes(String(o.default_color_mode)) ? (o.default_color_mode as ColorMode) : "system",
    website: (o.website as string) ?? null,
    contactEmail: (o.contact_email as string) ?? null,
    contactPhone: (o.contact_phone as string) ?? null,
    logoUrl: o.logo_path ? `/api/branding/${o.id}/logo?v=${version}` : null,
    logoMime: (o.logo_mime as string) ?? null,
    logoWidth: (o.logo_width as number) ?? null,
    logoHeight: (o.logo_height as number) ?? null,
    brandingVersion: version,
  };
}

export async function updateBranding(ctx: AuthContext, raw: BrandingInput) {
  assertPermission(ctx, "branding.manage");
  const input = brandingInputSchema.parse(raw);
  return withTx(async (q) => {
    const [before] = await q.query<Record<string, unknown>>(
      "select name, app_name, short_name, theme, default_color_mode, website, contact_email, contact_phone, branding_version from organizations where id = $1 for update",
      [ctx.organizationId],
    );
    if (!before) throw notFound("Organization");
    const [after] = await q.query<Record<string, unknown>>(
      `update organizations set name=$2, app_name=$3, short_name=$4, theme=$5, website=$6, contact_email=$7, contact_phone=$8,
              default_color_mode = coalesce($9::text, default_color_mode),
              branding_version = branding_version + 1
        where id = $1
        returning name, app_name, short_name, theme, default_color_mode, website, contact_email, contact_phone, branding_version`,
      [ctx.organizationId, input.companyName, input.appName, input.shortName, input.theme, input.website ?? null, input.contactEmail ?? null, input.contactPhone ?? null,
        input.defaultColorMode ?? null],
    );
    await writeAudit(q, ctx, { action: "branding.updated", entityType: "organization", entityId: ctx.organizationId, summary: "Company branding updated", before, after });
    return { brandingVersion: Number(after.branding_version) };
  });
}

const LOGO_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

/**
 * Validates and stores a logo. Accepts PNG/JPEG/WebP only (magic bytes AND decoder
 * agree), ≤5 MB, 64–6000 px. The stored object is the uploaded buffer, unmodified.
 */
export async function uploadLogo(ctx: AuthContext, data: Buffer) {
  assertPermission(ctx, "branding.manage");
  if (!data || data.length === 0) throw badRequest("No file uploaded");
  if (data.length > 5 * 1024 * 1024) throw badRequest("Logo must be 5 MB or smaller");
  const sniffed = sniffType(data);
  if (!sniffed || !LOGO_EXT[sniffed]) throw badRequest("Logo must be a PNG, JPEG or WebP image");
  let meta: { mime: string; width: number; height: number };
  try {
    meta = await inspectLogo(data);
  } catch (e) {
    throw badRequest(e instanceof Error && /Logo must/.test(e.message) ? e.message : "The image could not be read");
  }
  if (meta.mime !== sniffed) throw badRequest("File content does not match its image type");
  const objectPath = buildObjectPath(ctx.organizationId, "branding", `logo${LOGO_EXT[sniffed]}`);
  const stored = await putObject(objectPath, data, sniffed);
  const logoPath = stored.driver === "supabase" ? `sb:${stored.path}` : stored.path;
  return withTx(async (q) => {
    const [before] = await q.query<Record<string, unknown>>(
      "select logo_path, logo_mime, logo_width, logo_height, branding_version from organizations where id = $1 for update",
      [ctx.organizationId],
    );
    const [after] = await q.query<{ branding_version: number }>(
      `update organizations set logo_path=$2, logo_mime=$3, logo_width=$4, logo_height=$5, branding_version = branding_version + 1
        where id = $1 returning logo_path, logo_mime, logo_width, logo_height, branding_version`,
      [ctx.organizationId, logoPath, sniffed, meta.width, meta.height],
    );
    await writeAudit(q, ctx, {
      action: "branding.logo_uploaded", entityType: "organization", entityId: ctx.organizationId,
      summary: `Logo uploaded (${sniffed}, ${meta.width}×${meta.height}, ${data.length} bytes)`, before, after,
    });
    return { brandingVersion: Number(after.branding_version), mime: sniffed, width: meta.width, height: meta.height, bytes: data.length };
  });
}

/** Public: the stored logo bytes for an organization (null when none). */
export async function loadOrganizationLogo(orgId: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!isUuid(orgId)) return null;
  const q = await db();
  const [o] = await q.query<{ logo_path: string | null; logo_mime: string | null }>(
    "select logo_path, logo_mime from organizations where id = $1",
    [orgId],
  );
  if (!o?.logo_path || !o.logo_mime || !LOGO_EXT[o.logo_mime]) return null;
  const isSb = o.logo_path.startsWith("sb:");
  try {
    const data = await getObject({ driver: isSb ? "supabase" : "local", path: o.logo_path.replace(/^sb:/, "") });
    return { data, mime: o.logo_mime };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Domains (white-label install identities)
// ---------------------------------------------------------------------------
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{2,5})?$/;

export interface DomainRow {
  id: string;
  domain: string;
  is_primary: boolean;
  verified: boolean;
  created_at: Date;
}

export async function listDomains(ctx: AuthContext): Promise<DomainRow[]> {
  assertPermission(ctx, "branding.manage");
  return (await db()).query<DomainRow>(
    "select id, domain, is_primary, verified, created_at from organization_domains where organization_id = $1 order by is_primary desc, domain",
    [ctx.organizationId],
  );
}

export async function addDomain(ctx: AuthContext, rawDomain: string) {
  assertPermission(ctx, "branding.manage");
  const domain = normalizeHost(String(rawDomain ?? "").replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
  if (!domain || domain.length > 253 || !DOMAIN_RE.test(domain) || !domain.includes(".")) throw badRequest("Enter a valid domain or subdomain, e.g. app.example.com");
  return withTx(async (q) => {
    const [{ n }] = await q.query<{ n: number }>("select count(*)::int as n from organization_domains where organization_id = $1", [ctx.organizationId]);
    let row: DomainRow;
    try {
      [row] = await q.query<DomainRow>(
        "insert into organization_domains (organization_id, domain, is_primary, verified) values ($1,$2,$3,false) returning id, domain, is_primary, verified, created_at",
        [ctx.organizationId, domain, n === 0],
      );
    } catch (e) {
      if (isPgError(e, "23505")) throw conflict("This domain is already registered");
      throw e;
    }
    await writeAudit(q, ctx, { action: "domain.added", entityType: "organization_domain", entityId: row.id, summary: `Domain ${domain} added`, after: row });
    return row;
  });
}

async function lockDomain(q: Queryable, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw notFound("Domain");
  const [d] = await q.query<DomainRow>(
    "select id, domain, is_primary, verified, created_at from organization_domains where organization_id = $1 and id = $2 for update",
    [ctx.organizationId, id],
  );
  if (!d) throw notFound("Domain");
  return d;
}

export async function removeDomain(ctx: AuthContext, id: string) {
  assertPermission(ctx, "branding.manage");
  return withTx(async (q) => {
    const d = await lockDomain(q, ctx, id);
    await q.query("delete from organization_domains where id = $1 and organization_id = $2", [id, ctx.organizationId]);
    await writeAudit(q, ctx, { action: "domain.removed", entityType: "organization_domain", entityId: id, summary: `Domain ${d.domain} removed`, before: d });
    return { ok: true };
  });
}

export async function setPrimaryDomain(ctx: AuthContext, id: string) {
  assertPermission(ctx, "branding.manage");
  return withTx(async (q) => {
    const d = await lockDomain(q, ctx, id);
    await q.query("update organization_domains set is_primary = false where organization_id = $1 and is_primary and id <> $2", [ctx.organizationId, id]);
    await q.query("update organization_domains set is_primary = true where id = $1", [id]);
    await writeAudit(q, ctx, { action: "domain.primary_set", entityType: "organization_domain", entityId: id, summary: `Primary domain set to ${d.domain}` });
    return { ok: true };
  });
}

/** Marks a domain verified — only through an explicit administrator confirmation that DNS is configured. */
export async function confirmDomainDns(ctx: AuthContext, id: string, confirmed: boolean) {
  assertPermission(ctx, "branding.manage");
  if (confirmed !== true) throw badRequest("Confirm that DNS has been configured for this domain");
  return withTx(async (q) => {
    const d = await lockDomain(q, ctx, id);
    await q.query("update organization_domains set verified = true where id = $1", [id]);
    await writeAudit(q, ctx, {
      action: "domain.dns_confirmed", entityType: "organization_domain", entityId: id,
      summary: `Administrator confirmed DNS for ${d.domain}`, metadata: { method: "admin_attestation" },
    });
    return { ok: true };
  });
}

export async function unverifyDomain(ctx: AuthContext, id: string) {
  assertPermission(ctx, "branding.manage");
  return withTx(async (q) => {
    const d = await lockDomain(q, ctx, id);
    await q.query("update organization_domains set verified = false where id = $1", [id]);
    await writeAudit(q, ctx, { action: "domain.unverified", entityType: "organization_domain", entityId: id, summary: `Domain ${d.domain} marked unverified` });
    return { ok: true };
  });
}
