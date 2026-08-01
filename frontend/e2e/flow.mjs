/**
 * Exercises the full client-side flow with no backend running:
 * upload a photo -> wall auto-detected -> pick a colour -> render -> reload
 * and confirm the room was remembered.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.E2E_OUT ?? "e2e/output";
mkdirSync(OUT, { recursive: true });

// Read from disk and handed to the file input, so it need not be web-served.
const PHOTO = process.argv[2] ?? "e2e/assets/room.jpg";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1500 } });

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

function step(msg) {
  console.log(`- ${msg}`);
}

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
step("loaded landing page");

await page.waitForSelector("input[type=file]", { state: "attached" });
await page.setInputFiles("input[type=file]", PHOTO);
step(`uploaded ${PHOTO}`);

// Wall detection runs in the browser; give it room on a slow machine.
await page.waitForSelector("text=/% of the photo selected as wall/", { timeout: 300000 });
const cover = await page.textContent("text=/% of the photo selected as wall/");
step(`detection finished: ${cover.trim()}`);
await page.screenshot({ path: `${OUT}/flow-1-detected.png`, fullPage: true });

// Pick a colour by typing its Berger code.
await page.click(".color-picker input");
await page.fill(".color-picker input", "NF-R06");
await page.waitForSelector(".color-picker-option");
const optionText = await page.textContent(".color-picker-option");
await page.click(".color-picker-option");
step(`picked colour by code: ${optionText.trim()}`);

await page.waitForSelector(".render-image-wrap canvas", { timeout: 60000 });
step("render appeared");
await page.screenshot({ path: `${OUT}/flow-2-rendered.png`, fullPage: true });

// Sample the rendered canvas to prove the wall actually changed colour.
const sample = await page.evaluate(() => {
  const c = document.querySelector(".render-image-wrap canvas");
  const ctx = c.getContext("2d");
  const p = ctx.getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.45), 1, 1).data;
  return { r: p[0], g: p[1], b: p[2], w: c.width, h: c.height };
});
step(`render canvas ${sample.w}x${sample.h}, centre pixel rgb(${sample.r},${sample.g},${sample.b})`);

// Download button present?
const hasDownload = await page.isVisible("text=Download image");
step(`download button visible: ${hasDownload}`);

// Reload and confirm persistence.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".render-image-wrap canvas, .render-placeholder", { timeout: 120000 });
const remembered = await page.isVisible(".render-image-wrap canvas");
step(`after reload, room remembered with render: ${remembered}`);
await page.screenshot({ path: `${OUT}/flow-3-reloaded.png`, fullPage: true });

if (errors.length) {
  console.log(`\nerrors (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e.slice(0, 300)}`);
} else {
  console.log("\nno console errors");
}

await browser.close();
