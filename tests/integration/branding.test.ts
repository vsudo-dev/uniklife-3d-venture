import { beforeAll, describe, expect, it, vi } from "vitest";

// Keep test uploads out of the shared dev upload folder (must run before modules load env).
vi.hoisted(() => {
  process.env.LOCAL_UPLOAD_DIR = `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/uniklife-branding-test-${process.pid}`;
});

import sharp from "sharp";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor } from "../support/db";
import { AppError } from "@/lib/errors";
import { loadBranding } from "@/lib/tenant";
import { buildManifest, validateManifest } from "@/lib/pwa/manifest";
import { inspectLogo, renderIcon } from "@/lib/pwa/icons";
import {
  addDomain, confirmDomainDns, getBrandingSettings, listDomains, loadOrganizationLogo, setPrimaryDomain, updateBranding, uploadLogo,
} from "@/lib/services/branding";

let db: Database;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  db = await createTestDb();
  orgA = (await db.query<{ id: string }>("select id from organizations where slug = 'demo-ventures'"))[0].id;
  orgB = (await db.query<{ id: string }>("select id from organizations where slug = 'sample-realty-b'"))[0].id;
});

async function expectRejected(p: Promise<unknown>, status = 400) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeTruthy();
  if (e instanceof AppError) expect(e.status).toBe(status);
  else expect((e as Error).name).toBe("ZodError");
}

const pngOf = (w: number, h: number, color = { r: 220, g: 20, b: 20, alpha: 1 }) =>
  sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();

describe("PWA manifest per tenant", () => {
  it("produces distinct, valid manifests and icons for two tenants", async () => {
    const a = await loadBranding(db, orgA);
    const b = await loadBranding(db, orgB);
    const ma = buildManifest(a);
    const mb = buildManifest(b);
    expect(validateManifest(ma)).toEqual([]);
    expect(validateManifest(mb)).toEqual([]);
    expect(ma.id).not.toBe(mb.id);
    expect(ma.name).not.toBe(mb.name);
    expect(ma.short_name).not.toBe(mb.short_name);
    expect(ma.theme_color).not.toBe(mb.theme_color);
    const ia = await renderIcon(192, a, null);
    const ib = await renderIcon(192, b, null);
    expect(Buffer.compare(ia, ib)).not.toBe(0);
    const metaA = await sharp(ia).metadata();
    expect(metaA.width).toBe(192);
    expect(metaA.height).toBe(192);
    // Platform branding has its own identity too.
    expect(buildManifest(await loadBranding(db, null)).id).toBe("/?app=platform");
  });

  it("validateManifest flags a long short_name", async () => {
    const m = buildManifest({ ...(await loadBranding(db, orgA)), shortName: "ThirteenChars" });
    expect(validateManifest(m).join(" ")).toMatch(/short_name/);
  });
});

describe("branding service", () => {
  it("rejects short names longer than 12 characters and increments branding_version on save", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const before = await getBrandingSettings(ceo);
    const input = {
      companyName: before.companyName, appName: "Demo Ventures App", shortName: "ThirteenChars", theme: "ivory" as const,
      website: "https://example.com", contactEmail: null, contactPhone: null,
    };
    await expectRejected(updateBranding(ceo, input));
    expect((await getBrandingSettings(ceo)).brandingVersion).toBe(before.brandingVersion);
    const res = await updateBranding(ceo, { ...input, shortName: "DemoApp" });
    expect(res.brandingVersion).toBe(before.brandingVersion + 1);
    const after = await loadBranding(db, orgA);
    expect(after.shortName).toBe("DemoApp");
    expect(after.theme).toBe("ivory");
    expect(validateManifest(buildManifest(after))).toEqual([]);

    const anil = await ctxFor(db, "anil@demo.local");
    await expectRejected(updateBranding(anil, { ...input, shortName: "X" }), 403);
  });

  it("rejects SVG, GIF and oversized logos", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><script>alert(1)</script><rect width="200" height="200"/></svg>');
    await expectRejected(uploadLogo(ceo, svg));
    await expect(inspectLogo(svg)).rejects.toThrow(/PNG, JPEG or WebP/);

    const gif = Buffer.concat([
      Buffer.from("GIF89a", "ascii"),
      Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b]),
    ]);
    await expectRejected(uploadLogo(ceo, gif));

    const big = Buffer.alloc(5 * 1024 * 1024 + 10);
    (await pngOf(100, 100)).copy(big);
    await expectRejected(uploadLogo(ceo, big));

    // Too small, and a PNG header in front of non-image bytes.
    await expectRejected(uploadLogo(ceo, await pngOf(32, 32)));
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a png")]);
    await expectRejected(uploadLogo(ceo, fake));
    expect((await getBrandingSettings(ceo)).logoUrl).toBeNull();
  });

  it("accepts a PNG, stores it byte-for-byte and bumps the version", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const before = await getBrandingSettings(ceo);
    const png = await pngOf(400, 160);
    const res = await uploadLogo(ceo, png);
    expect(res).toMatchObject({ mime: "image/png", width: 400, height: 160 });
    expect(res.brandingVersion).toBe(before.brandingVersion + 1);
    const s = await getBrandingSettings(ceo);
    expect(s.logoUrl).toBe(`/api/branding/${orgA}/logo?v=${res.brandingVersion}`);
    expect(s.logoWidth).toBe(400);
    expect(s.logoHeight).toBe(160);
    const stored = await loadOrganizationLogo(orgA);
    expect(stored?.mime).toBe("image/png");
    expect(stored && Buffer.compare(stored.data, png)).toBe(0);
    expect(await loadOrganizationLogo(orgB)).toBeNull();
    expect(await loadOrganizationLogo("not-a-uuid")).toBeNull();
  });

  it("manages domains with explicit DNS confirmation", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const d = await addDomain(ceo, "https://Sales.Example.com/");
    expect(d.domain).toBe("sales.example.com");
    expect(d.verified).toBe(false);
    await expectRejected(addDomain(ceo, "demo.localhost:3000"), 409);
    await expectRejected(addDomain(ceo, "bad domain!"));
    await expectRejected(confirmDomainDns(ceo, d.id, false as unknown as boolean));
    await confirmDomainDns(ceo, d.id, true);
    await setPrimaryDomain(ceo, d.id);
    const list = await listDomains(ceo);
    expect(list.filter((x) => x.is_primary).map((x) => x.domain)).toEqual(["sales.example.com"]);
    const bAdmin = await ctxFor(db, "admin@sample-b.local");
    await expectRejected(setPrimaryDomain(bAdmin, d.id), 404);
  });
});

describe("icon rendering", () => {
  it("preserves the aspect ratio of a wide logo on an opaque square", async () => {
    const branding = await loadBranding(db, orgB); // midnight theme
    const wide = await pngOf(1000, 200);
    const icon = await renderIcon(512, branding, wide);
    const meta = await sharp(icon).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    const stats = await sharp(icon).stats();
    expect(stats.isOpaque).toBe(true);
    const { data, info } = await sharp(icon).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Logo occupies 80% width (≈410px) → height ≈82px, centred: rows 215..297.
    expect(px(256, 256)).toEqual([220, 20, 20]);
    expect(px(60, 256)).toEqual([220, 20, 20]);
    expect(px(256, 180)).not.toEqual([220, 20, 20]); // above the logo band: background, not stretched logo
    expect(px(256, 330)).not.toEqual([220, 20, 20]);
    expect(px(10, 10)).toEqual([6, 11, 29]); // #060b1d midnight background
    const maskable = await renderIcon(512, branding, wide, true);
    const { data: md, info: mi } = await sharp(maskable).raw().toBuffer({ resolveWithObject: true });
    const mpx = (x: number, y: number) => { const i = (y * mi.width + x) * mi.channels; return [md[i], md[i + 1], md[i + 2]]; };
    expect(mpx(60, 256)).toEqual([6, 11, 29]); // larger safe zone on maskable icons
    expect(mpx(256, 256)).toEqual([220, 20, 20]);
  });
});
