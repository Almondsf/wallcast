/** Watches what the live site actually downloads, and how long each piece takes. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "https://wallcast.netlify.app";
const browser = await chromium.launch();
const page = await browser.newPage();

const started = Date.now();
const inflight = new Map();
const done = [];

page.on("request", (r) => inflight.set(r, Date.now()));
page.on("response", async (r) => {
  const t0 = inflight.get(r.request()) ?? started;
  let size = r.headers()["content-length"] ?? "?";
  done.push({
    ms: Date.now() - t0,
    at: Date.now() - started,
    status: r.status(),
    enc: r.headers()["content-encoding"] ?? "-",
    size,
    url: r.url().replace(BASE, "").slice(0, 90),
  });
});
page.on("requestfailed", (r) =>
  done.push({ ms: Date.now() - (inflight.get(r) ?? started), at: Date.now() - started, status: "FAIL", enc: "-", size: "-", url: `${r.url().slice(0, 90)} (${r.failure()?.errorText})` }),
);
page.on("console", (m) => {
  if (m.type() === "error" || /model|wasm|onnx/i.test(m.text())) {
    console.log(`  [console:${m.type()}] ${m.text().slice(0, 160)}`);
  }
});

console.log(`opening ${BASE}\n`);
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

// Wait for the model to finish loading (the upload page hides its progress line).
const ok = await page
  .waitForFunction(
    () => !document.body.textContent.includes("Preparing wall detection"),
    null,
    { timeout: 420000 },
  )
  .then(() => true)
  .catch(() => false);

console.log(`\nmodel ready within timeout: ${ok}  (${((Date.now() - started) / 1000).toFixed(0)}s elapsed)\n`);
console.log("network:");
console.log("  at(s)  took(s)  status  enc      size  url");
for (const d of done.sort((a, b) => a.at - b.at)) {
  const sz = d.size === "?" || d.size === "-" ? d.size : `${(Number(d.size) / 1024 / 1024).toFixed(2)}MB`;
  console.log(
    `  ${(d.at / 1000).toFixed(1).padStart(5)}  ${(d.ms / 1000).toFixed(1).padStart(6)}  ` +
      `${String(d.status).padStart(6)}  ${d.enc.padEnd(6)}  ${String(sz).padStart(8)}  ${d.url}`,
  );
}

await browser.close();
