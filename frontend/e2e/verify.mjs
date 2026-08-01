/**
 * Runs the mask-op port verification page and reports the result.
 * Requires fixtures in public/fixtures (see scratchpad/make_fixtures.py).
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();

// Fixtures are served from disk rather than public/, so they never reach a
// production build. They are derived from real photos and don't belong there.
await page.route("**/fixtures/*", async (route, request) => {
  const name = request.url().split("/").pop();
  const type = name.endsWith(".json") ? "application/json" : "image/png";
  try {
    await route.fulfill({ path: `e2e/assets/fixtures/${name}`, contentType: type });
  } catch {
    await route.fulfill({ status: 404, body: "missing fixture" });
  }
});

const errors = [];
page.on("pageerror", (e) => errors.push(`${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto("http://localhost:5173/verify.html", { waitUntil: "domcontentloaded" });

try {
  await page.waitForFunction(() => window.__verify !== undefined, null, { timeout: 180000 });
} catch (e) {
  console.log(`WAIT FAILED: ${e.message.split("\n")[0]}`);
}

console.log(await page.textContent("#log"));

const out = await page.evaluate(() => window.__verify);
if (errors.length) {
  console.log(`\nerrors:`);
  for (const e of errors.slice(0, 6)) console.log(`  ${e.slice(0, 300)}`);
}

await browser.close();
process.exit(out && out.failures === 0 ? 0 : 1);
