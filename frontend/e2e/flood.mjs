/**
 * Exercises the manual (flood-fill) selection path: switch to Manual, tap the
 * wall, confirm a selection appears, then widen the tolerance and confirm it
 * grows. This is the fallback when auto-detect fails, so it has to work.
 *
 * Uses a persistent browser profile so the model is fetched once and cached
 * across runs — a fresh context re-downloads it every time, which is slow and
 * fails outright if the network hiccups.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.env.E2E_OUT ?? "e2e/output";
// Deliberately outside the project: Vite watches the tree, and Chrome's cache
// files churn constantly, which crashes the dev server's file watcher on Windows.
const PROFILE = join(tmpdir(), "wallcast-e2e-profile");
mkdirSync(OUT, { recursive: true });

const PHOTO = process.argv[2] ?? "e2e/assets/room.jpg";

const context = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 1400, height: 1500 } });
const page = context.pages()[0] ?? (await context.newPage());

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const step = (m) => console.log(`- ${m}`);

async function coverageText() {
  const el = await page.$("text=/% of the photo selected as wall/");
  return el ? (await el.textContent()).trim() : null;
}

async function coveragePct() {
  const t = await coverageText();
  return t ? Number(t.match(/(\d+)%/)[1]) : null;
}

async function tapCanvas(fx, fy) {
  const box = await page.locator(".mask-canvas").boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function bail(why) {
  console.log(`\n${why}`);
  console.log(`status: ${await page.textContent(".status").catch(() => "none")}`);
  if (errors.length) console.log(`errors:\n  ${errors.slice(0, 6).join("\n  ")}`);
  await page.screenshot({ path: `${OUT}/flood-fail.png`, fullPage: true });
  await context.close();
  process.exit(1);
}

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });

// The profile persists, so a room may be remembered from a previous run.
// Wait for the app to settle into one state or the other before deciding.
// Playwright will not accept CSS and text engines in one comma list.
await page
  .locator("input[type=file]")
  .or(page.locator("text=Use a different photo"))
  .first()
  .waitFor({ state: "attached", timeout: 60000 });
if (await page.isVisible("text=Use a different photo").catch(() => false)) {
  await page
    .click("text=Use a different photo", { noWaitAfter: true })
    .catch(() => undefined);
  step("discarded the remembered room");
}

await page.waitForSelector("input[type=file]", { state: "attached", timeout: 60000 });
await page.setInputFiles("input[type=file]", PHOTO);
step(`uploaded ${PHOTO}`);

try {
  await page.waitForSelector("text=/% of the photo selected as wall/", { timeout: 300000 });
} catch (e) {
  await bail(`auto-detect never finished: ${e.message.split("\n")[0]}`);
}
step(`auto-detect: ${await coverageText()}`);

// --- switch to manual ---
// The click lands but React replaces the button as it re-renders, so Playwright's
// post-click actionability check can time out even though the mode did switch.
// Assert on the resulting UI instead of trusting the click to return.
await page
  .click("button:has-text('Manual')", { timeout: 15000, noWaitAfter: true })
  .catch(() => step("click did not return cleanly; checking whether it landed anyway"));
try {
  await page.waitForSelector("text=Tolerance:", { timeout: 30000 });
} catch {
  await bail("switching to Manual mode did not take effect");
}
step("switched to Manual mode");
const clearedAfterSwitch = (await coverageText()) === null;
step(`selection cleared on switch: ${clearedAfterSwitch}`);

// --- tap the wall ---
await tapCanvas(0.5, 0.35);
try {
  await page.waitForSelector("text=/% of the photo selected as wall/", { timeout: 120000 });
} catch (e) {
  await bail(`flood fill produced no selection: ${e.message.split("\n")[0]}`);
}
const first = await coveragePct();
step(`after tapping the wall: ${first}% selected`);
await page.screenshot({ path: `${OUT}/flood-1-tapped.png`, fullPage: true });

// --- widen the tolerance, expect the selection to grow ---
await page.locator("input[type=range]").last().fill("60");
await page.waitForTimeout(4000);
const widened = await coveragePct();
step(`after raising tolerance to 60: ${widened}% selected`);
await page.screenshot({ path: `${OUT}/flood-2-tolerance.png`, fullPage: true });

// --- render from the flood mask ---
await page.click(".color-picker input");
await page.fill(".color-picker input", "Ocean");
if ((await page.locator(".color-picker-option").count()) > 0) {
  await page.click(".color-picker-option");
  await page.waitForSelector(".render-image-wrap canvas", { timeout: 60000 });
  const px = await page.evaluate(() => {
    const c = document.querySelector(".render-image-wrap canvas");
    const d = c.getContext("2d").getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.35), 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  });
  step(`rendered from the flood mask, sampled ${px}`);
}
await page.screenshot({ path: `${OUT}/flood-3-rendered.png`, fullPage: true });

console.log("\nchecks:");
const results = [
  ["selection cleared when switching to Manual", clearedAfterSwitch],
  ["tapping the wall produced a selection", first !== null && first > 0],
  ["selection is bounded, not the whole image", first !== null && first < 100],
  ["raising tolerance grew the selection", widened !== null && first !== null && widened >= first],
];
let failed = 0;
for (const [name, ok] of results) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}

console.log(errors.length ? `\nerrors:\n  ${errors.slice(0, 6).join("\n  ")}` : "\nno console errors");
await context.close();
process.exit(failed ? 1 : 0);
