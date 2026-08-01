/**
 * Cross-checks the TypeScript mask operations against reference output from the
 * Python implementation they were ported from.
 *
 * These are pixel-level algorithms where a subtly wrong port still looks
 * plausible, so "it renders something" is not evidence. Fixtures come from
 * scratchpad/make_fixtures.py.
 */

import { refineMask, straightenMask, type Mask } from "./lib/maskOps";

const logEl = document.getElementById("log")!;
const lines: string[] = [];
let failures = 0;

function log(line: string, cls?: string) {
  lines.push(cls ? `<span class="${cls}">${line}</span>` : line);
  logEl.innerHTML = lines.join("\n");
}

declare global {
  interface Window {
    __verify?: { failures: number; results: unknown[] };
  }
}

async function loadMask(name: string): Promise<Mask> {
  const res = await fetch(`/fixtures/${name}.png`);
  if (!res.ok) throw new Error(`missing fixture ${name} (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const data = new Uint8Array(bitmap.width * bitmap.height);
  for (let p = 0; p < data.length; p++) data[p] = px[p * 4] > 127 ? 1 : 0;
  return { data, width: bitmap.width, height: bitmap.height };
}

const results: unknown[] = [];

function compare(label: string, got: Mask, want: Mask, tolerancePct: number) {
  let diff = 0;
  for (let i = 0; i < got.data.length; i++) {
    if ((got.data[i] ? 1 : 0) !== (want.data[i] ? 1 : 0)) diff++;
  }
  const pct = (diff / got.data.length) * 100;
  const ok = pct <= tolerancePct;
  if (!ok) failures++;
  results.push({ label, diffPct: Number(pct.toFixed(4)), tolerancePct, ok });
  log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(28)} ${pct.toFixed(4)}% of pixels differ ` +
      `(tolerance ${tolerancePct}%)`,
    ok ? "pass" : "fail",
  );
}

async function run() {
  try {
    for (const kase of ["a", "b"]) {
      log(`\n--- case ${kase.toUpperCase()} ---`);
      const input = await loadMask(`${kase}_input`);

      compare(`${kase}: refineMask`, refineMask(input), await loadMask(`${kase}_refine`), 0.5);
      compare(
        `${kase}: straighten 0.004`,
        straightenMask(input, 0.004),
        await loadMask(`${kase}_straight_004`),
        1.0,
      );
      compare(
        `${kase}: straighten 0.02`,
        straightenMask(input, 0.02),
        await loadMask(`${kase}_straight_02`),
        2.0,
      );
    }

    log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`, failures ? "fail" : "pass");
  } catch (e) {
    failures++;
    log(`\nERROR: ${e instanceof Error ? e.message : String(e)}`, "fail");
  } finally {
    window.__verify = { failures, results };
    document.title = failures === 0 ? "verify-pass" : "verify-fail";
  }
}

run();
