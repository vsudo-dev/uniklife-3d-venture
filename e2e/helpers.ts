import type { Page } from "@playwright/test";

export const DEMO_VENTURE_CODE = "SUNRISE-DEMO";

// Session cookies are reused per user so the suite doesn't trip the (intentional)
// login rate limit of 10 attempts/minute per IP.
const sessions = new Map<string, Awaited<ReturnType<Page["context"]>>["addCookies"] extends (c: infer C) => unknown ? C : never>();

/** Signs in through the API (fast and immune to dev-server hot reloads). */
export async function login(page: Page, email: string) {
  const cached = sessions.get(email);
  if (cached) {
    await page.context().addCookies(cached);
    return;
  }
  let res = await page.request.post("/api/auth/login", { data: { email, password: "Demo@12345" } });
  if (res.status() === 429) {
    await page.waitForTimeout(61_000);
    res = await page.request.post("/api/auth/login", { data: { email, password: "Demo@12345" } });
  }
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
  const cookies = (await page.context().cookies()).filter((c) => c.name === "ul_session");
  sessions.set(email, cookies);
}

/** Navigates and waits until React has hydrated (interactive). */
export async function go(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1", null, { timeout: 120_000 });
}

export async function demoVentureId(page: Page): Promise<string> {
  const html = await (await page.request.get("/ventures")).text();
  const m = /\/ventures\/([0-9a-f-]{36})/.exec(html);
  if (!m) throw new Error("demo venture not found");
  return m[1];
}

export async function openViewer(page: Page, id: string) {
  await go(page, `/ventures/${id}`);
  await page.waitForSelector("[data-testid=viewer-root]");
}
