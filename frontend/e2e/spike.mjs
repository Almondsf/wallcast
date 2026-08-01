/**
 * Drives the browser-segmentation spike and reports real timings.
 * Usage: node e2e/spike.mjs <photo-url> [maxEdge]
 */
import { chromium } from "playwright";

import { mkdirSync } from "node:fs";

// Screenshots land here; override with E2E_OUT.
const OUT = process.env.E2E_OUT ?? "e2e/output";
mkdirSync(OUT, { recursive: true });
const photo = process.argv[2];
const maxEdge = process.argv[3] ?? "1024";
const tag = process.argv[4] ?? "spike";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });

const errors = [];
const console_ = [];
page.on("console", (m) => {
  console_.push(`[${m.type()}] ${m.text()}`);
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));
page.on("requestfailed", (r) =>
  errors.push(`requestfailed: ${r.url().slice(0, 160)} — ${r.failure()?.errorText}`),
);
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().slice(0, 160)}`);
});

// How much a first-time visitor actually downloads for the model.
let modelBytes = 0;
const assets = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/huggingface\.co|hf\.co|cdn-lfs/.test(u)) return;
  try {
    const len = Number(r.headers()["content-length"] ?? 0);
    if (len > 0) {
      modelBytes += len;
      assets.push(`${(len / 1024 / 1024).toFixed(2)} MB  ${u.split("/").pop()?.slice(0, 60)}`);
    }
  } catch {
    /* ignore */
  }
});

const extra = process.env.SPIKE_QUERY ?? "";
const url = `http://localhost:5173/spike.html?img=${encodeURIComponent(photo)}&maxEdge=${maxEdge}${extra}`;
console.log(`opening ${url}\n`);

const started = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded" });

try {
  // Third arg is options; the second is the function's own argument. Passing
  // options in slot two silently leaves the default 30s timeout in place.
  await page.waitForFunction(() => window.__spike !== undefined, null, { timeout: 600000 });
} catch (e) {
  console.log(`WAIT FAILED: ${e.message.split("\n")[0]}`);
}

const result = await page.evaluate(() => window.__spike);
const log = await page.textContent("#log");

console.log(log);
console.log(`\nwall clock: ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`model download: ${(modelBytes / 1024 / 1024).toFixed(2)} MB`);
for (const a of assets) console.log(`  ${a}`);
console.log(`\nresult: ${JSON.stringify(result, null, 2)}`);

if (errors.length) {
  console.log(`\nerrors (${errors.length}):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e.slice(0, 400)}`);
}
if (!result?.ok) {
  console.log(`\nconsole tail:`);
  for (const c of console_.slice(-15)) console.log(`  ${c.slice(0, 220)}`);
}

await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: true });
console.log(`\nscreenshot -> ${tag}.png`);

await browser.close();
