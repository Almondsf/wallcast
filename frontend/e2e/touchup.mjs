import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

// Screenshots land here; override with E2E_OUT.
const OUT = process.env.E2E_OUT ?? "e2e/output";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 1000 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("requestfailed", (r) => errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });

// Log in
await page.fill('input[type="email"]', "smoketest@wallcast.dev");
await page.fill('input[type="password"]', "testpass123");
await page.click('button[type="submit"]');
await page.waitForSelector(".project-grid, .hint", { timeout: 30000 });
console.log("logged in");

// Open the last project — the real room photo, not the synthetic smoke-test image
await page.locator(".project-card").last().click();
await page.waitForSelector(".mask-canvas", { timeout: 30000 });
console.log("project opened");

// Wait for auto-detect to finish (coverage hint appears)
// NOTE: waitForFunction is (fn, arg, options) — the null arg slot is required,
// otherwise the options object is passed to the page function and the default
// 30s timeout applies (which is shorter than a cold model load).
await page.waitForFunction(
  () => [...document.querySelectorAll(".hint")].some((e) => /% of the photo/.test(e.textContent || "")),
  null,
  { timeout: 240000 },
);
const cov = await page.locator(".hint", { hasText: "% of the photo" }).first().textContent();
console.log("auto-detect:", cov?.trim());
await page.screenshot({ path: `${OUT}/v1_auto.png` });

// Switch to Touch up
await page.getByRole("button", { name: "Touch up" }).click();
await page.waitForSelector(".mask-editor-overlay", { timeout: 15000 });
await page.waitForTimeout(2500); // let the mask image load into the canvas

// THE KEY CHECK: does the overlay canvas actually contain mask pixels?
const stats = await page.evaluate(() => {
  const c = document.querySelector(".mask-editor-overlay");
  if (!c) return { error: "no canvas" };
  const ctx = c.getContext("2d");
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let on = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 127) on++;
  return { w: c.width, h: c.height, maskedPct: +((100 * on) / (d.length / 4)).toFixed(1) };
});
console.log("overlay canvas:", JSON.stringify(stats));
await page.screenshot({ path: `${OUT}/v2_touchup.png` });

// Now simulate an erase stroke and confirm the mask changes + saves
const before = stats.maskedPct;
await page.getByRole("button", { name: "Erase" }).click();
const box = await page.locator(".mask-editor-stage").boundingBox();
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.25);
await page.mouse.down();
for (let i = 0; i <= 10; i++) {
  await page.mouse.move(box.x + box.width * (0.3 + i * 0.03), box.y + box.height * (0.25 + i * 0.02));
}
await page.mouse.up();
await page.waitForTimeout(3000);

const after = await page.evaluate(() => {
  const c = document.querySelector(".mask-editor-overlay");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let on = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 127) on++;
  return +((100 * on) / (d.length / 4)).toFixed(1);
});
console.log(`erase stroke: ${before}% -> ${after}%  (changed: ${before !== after})`);

const serverCov = await page.locator(".hint", { hasText: "% of the photo" }).first().textContent();
console.log("server coverage after edit:", serverCov?.trim());
await page.screenshot({ path: `${OUT}/v3_after_erase.png` });

console.log("errors:", errors.length ? errors.slice(0, 8) : "none");
await b.close();
