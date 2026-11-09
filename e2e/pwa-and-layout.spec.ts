import { expect, test } from "@playwright/test";
import { go, login } from "./helpers";

test.describe("PWA & white-label", () => {
  test("manifest is valid and tenant-specific per host", async ({ request }) => {
    const platform = await (await request.get("/manifest.webmanifest")).json();
    const tenant = await (await request.get("/manifest.webmanifest", { headers: { "x-forwarded-host": "demo.localhost:3000" } })).json();
    for (const m of [platform, tenant]) {
      expect(m.display).toBe("standalone");
      expect(m.start_url.startsWith("/")).toBe(true);
      expect(m.icons.some((i: { sizes: string }) => i.sizes === "192x192")).toBe(true);
      expect(m.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
      expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    }
    expect(tenant.name).toBe("Demo Ventures");
    expect(platform.id).not.toBe(tenant.id);
    const icon = await request.get("/api/pwa/icon/192");
    expect(icon.headers()["content-type"]).toBe("image/png");
  });

  test("offline fallback is served by the service worker", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "one browser is enough");
    await go(page, "/login");
    await page.waitForFunction(async () => (await navigator.serviceWorker?.getRegistration())?.active?.state === "activated", null, { timeout: 60_000 });
    // Activated is not enough: wait until the worker controls this page (clients.claim()).
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
    await context.setOffline(true);
    await page.goto("/dashboard").catch(() => undefined);
    await expect(page.locator("body")).toContainText("You're offline");
    await context.setOffline(false);
  });

  test("colour mode switcher applies light / dark / night", async ({ page }) => {
    await login(page, "ceo@demo.local");
    await go(page, "/dashboard");
    for (const mode of ["night", "dark", "light"]) {
      // Desktop: always-visible segmented switch; phones: compact menu.
      const seg = page.getByTestId(`seg-mode-${mode}`);
      if (await seg.isVisible()) await seg.click();
      else {
        await page.locator("[data-testid=mode-switcher]:visible").first().click();
        await page.getByTestId(`mode-${mode}`).click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    }
  });

  test("key pages have no horizontal scroll", async ({ page }) => {
    await login(page, "ceo@demo.local");
    for (const path of ["/dashboard", "/ventures", "/bookings", "/commissions", "/network", "/notifications", "/settings", "/site-visits"]) {
      await go(page, path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test("network privacy: a parallel team member cannot open another team's booking", async ({ page }) => {
    await login(page, "deepa@demo.local");
    const res = await page.request.get("/api/commissions/entries?scope=all");
    expect(res.status()).toBe(403);
  });
});
