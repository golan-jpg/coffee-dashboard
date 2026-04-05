import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.selectOption("#city", "New York");
await page.waitForTimeout(700);

for (const mode of ["Google Lists", "OSM Discovery", "Combined"]) {
  await page.locator(".mode-toggle button", { hasText: mode }).click();
  await page.waitForTimeout(mode === "OSM Discovery" ? 7000 : 2500);

  const count = await page.locator(".count").first().innerText().catch(() => null);
  const items = await page.locator(".cafe-item").count();
  const errorCount = await page.locator(".error").count();
  const errorText = errorCount
    ? await page.locator(".error").first().innerText().catch(() => null)
    : null;

  console.log(JSON.stringify({ mode, count, items, error: Boolean(errorCount), errorText }, null, 2));
}

await browser.close();
