import { expect, test } from "@playwright/test";
import { demoVentureId, login, openViewer } from "./helpers";

test("multi-plot booking: select plots → hold → booking → simulated advance → server-confirmed", async ({ page, isMobile }) => {
  test.skip(isMobile, "covered on desktop; mobile layout tested separately");
  test.setTimeout(420_000);
  await login(page, "anil@demo.local");
  await openViewer(page, await demoVentureId(page));
  await page.getByTestId("mode-2d").click();
  await page.getByTestId("tap-to-add").click();
  const available = page.locator('svg [role=button][aria-label*="Available"]');
  // Pick plots from the end of the list to avoid colliding with other tests.
  const count = await available.count();
  for (const i of [count - 1, count - 3]) await available.nth(i).click();
  await expect(page.getByTestId("selection-panel")).toContainText("Cart · 2 plots");
  await page.getByTestId("proceed-booking").click();

  await page.waitForURL(/\/bookings\/new/);
  await expect(page.getByText("Loading live prices")).toBeHidden({ timeout: 120_000 });
  await page.getByRole("button", { name: "New customer" }).click();
  await page.fill("#nc-name", "E2E Buyer");
  await page.fill("#nc-phone", `+9198${Date.now().toString().slice(-8)}`);
  await page.getByTestId("place-hold").click();
  await expect(page.getByTestId("hold-active")).toContainText("remaining");
  await page.getByTestId("submit-booking").click();

  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
  await page.getByTestId("pay-advance").click();
  await page.waitForURL(/\/pay\/mock\//);
  await expect(page.getByTestId("simulated-banner")).toBeVisible();
  await page.getByTestId("simulate-success").click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}\?paid=1/);
  // Status comes from the server, not the checkout screen.
  await expect(page.locator("main")).toContainText("confirmed");
  await expect(page.locator("main")).toContainText("Simulated payment");
});
