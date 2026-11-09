import { expect, test } from "@playwright/test";
import { demoVentureId, login, openViewer } from "./helpers";

test.describe("3D venture viewer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "anil@demo.local");
  });

  test("opens in aerial overview, labels the demo, and transitions to live plot intelligence on zoom", async ({ page, isMobile }) => {
    test.skip(isMobile, "wheel zoom is desktop-only; touch covered by 2D tests");
    const id = await demoVentureId(page);
    await openViewer(page, id);
    await page.waitForSelector("[data-testid=viewer-canvas] canvas", { timeout: 120_000 });
    await expect(page.getByTestId("demo-label")).toBeVisible();
    await expect(page.getByTestId("mode-indicator")).toHaveText(/Aerial overview/);
    await expect(page.getByTestId("aerial-ctas")).toBeVisible();

    const box = (await page.locator("[data-testid=viewer-canvas] canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 16; i++) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(100);
    }
    await expect(page.getByTestId("mode-indicator")).toHaveText(/Live plot intelligence/, { timeout: 15_000 });
    for (let i = 0; i < 22; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(80);
    }
    await expect(page.getByTestId("mode-indicator")).toHaveText(/Aerial overview/, { timeout: 15_000 });
  });

  test("cinematic tour starts and is interrupted immediately by user input", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop pointer");
    await openViewer(page, await demoVentureId(page));
    await page.waitForSelector("[data-testid=viewer-canvas] canvas", { timeout: 120_000 });
    await page.getByTestId("start-tour").click();
    await expect(page.getByTestId("tour-controls")).toBeVisible();
    const box = (await page.locator("[data-testid=viewer-canvas] canvas").boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 150);
    await page.mouse.wheel(0, -200);
    await expect(page.getByTestId("tour-controls")).toBeHidden({ timeout: 5_000 });
  });

  test("hologram and top view modes toggle without reloading the scene", async ({ page, isMobile }) => {
    test.skip(isMobile, "toolbar overflow on mobile is scrollable");
    await openViewer(page, await demoVentureId(page));
    await page.waitForSelector("[data-testid=viewer-canvas] canvas", { timeout: 120_000 });
    const canvas = page.locator("[data-testid=viewer-canvas] canvas");
    const handle = await canvas.elementHandle();
    await page.getByTestId("mode-holo").click();
    await expect(page.getByTestId("mode-holo")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("mode-top").click();
    await expect(page.getByTestId("mode-indicator")).toHaveText(/Live plot intelligence/);
    // Same canvas element — the scene was not recreated.
    expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
  });

  test("multi-plot cart: tap plot, add to cart, tap another, add again (2D)", async ({ page }) => {
    await openViewer(page, await demoVentureId(page));
    await page.getByTestId("mode-2d").click();
    const available = page.locator('svg [role=button][aria-label*="Available"]');
    await expect(available.first()).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await available.nth(i * 2).click();
      await page.locator("[data-testid=toggle-select]:visible").first().click();
    }
    await expect(page.getByTestId("selection-panel")).toContainText("Cart · 3 plots");
    // Tap-to-add mode adds directly with a single tap.
    await page.getByTestId("tap-to-add").click();
    await available.nth(8).click();
    await expect(page.getByTestId("selection-panel")).toContainText("Cart · 4 plots");
    // Compare
    await page.getByTestId("tap-to-add").click();
    await available.nth(10).click();
    // On phones the slim plot bar expands to full details (including Compare) on tap.
    const expand = page.locator('[aria-label^="Show details for plot"]:visible');
    if (await expand.count()) await expand.first().click();
    await page.locator("[data-testid=toggle-compare]:visible").first().click();
    await page.getByTestId("open-compare").click();
    await expect(page.getByTestId("compare-drawer")).toContainText("Base price");
  });

  test("opening animation is skippable and the tour flies over the plotted layout", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop pointer");
    await openViewer(page, await demoVentureId(page));
    await page.waitForSelector("[data-testid=viewer-canvas] canvas", { timeout: 120_000 });
    // Intro may already have finished on fast machines; if the button is there it must work.
    const skip = page.getByTestId("skip-intro");
    if (await skip.isVisible()) {
      await skip.click();
      await expect(skip).toBeHidden();
    }
    await expect(page.getByTestId("aerial-ctas")).toBeVisible();
    await page.getByTestId("start-tour").click();
    await expect(page.getByTestId("tour-controls")).toContainText(/Flying over the plotted layout|Main|entrance|Aerial approach|Park|Clubhouse/, { timeout: 30_000 });
    await expect(page.getByTestId("tour-controls")).toContainText("Flying over the plotted layout", { timeout: 90_000 });
    await page.getByTestId("exit-tour").click();
    await expect(page.getByTestId("tour-controls")).toBeHidden();
  });

  test("staff with edit rights can save the venture's opening view", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop toolbar");
    await login(page, "ceo@demo.local");
    const id = await demoVentureId(page);
    await openViewer(page, id);
    await page.waitForSelector("[data-testid=viewer-canvas] canvas", { timeout: 120_000 });
    await page.getByTestId("save-view").click();
    await expect(page.locator("[role=status]")).toContainText("customers will now open this venture from this view");
    const s = await (await page.request.get(`/api/ventures/${id}/viewer-settings`)).json();
    expect(s.customAerial ?? s.settings?.customAerial).toBeTruthy();
    // Restore automatic framing for other tests.
    await page.getByRole("button", { name: "Auto view" }).click();
  });

  test("non-available plots are announced with text, not colour alone", async ({ page }) => {
    await openViewer(page, await demoVentureId(page));
    await page.getByTestId("mode-2d").click();
    await expect(page.locator('svg [role=button][aria-label*="Booked"]').first()).toBeVisible();
    await expect(page.locator("svg text", { hasText: "BOOKED" }).first()).toBeVisible();
  });
});
