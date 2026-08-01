/**
 * Cross-checks the TypeScript mask operations against reference output from the
 * Python implementation they were ported from.
 *
 * These are pixel-level algorithms where a subtly wrong port still looks
 * plausible, so "it renders something" is not evidence. Fixtures come from
 * scratchpad/make_fixtures.py.
 */

import { canny, edgeBarrier, floodSelect, toGrayscale } from "./lib/imageOps";
import { coverage, refineMask, straightenMask, type Mask } from "./lib/maskOps";

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

async function loadImage(path: string): Promise<ImageData> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`missing fixture ${path} (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

async function loadMask(name: string): Promise<Mask> {
  const image = await loadImage(`/fixtures/${name}.png`);
  const data = new Uint8Array(image.width * image.height);
  for (let p = 0; p < data.length; p++) data[p] = image.data[p * 4] > 127 ? 1 : 0;
  return { data, width: image.width, height: image.height };
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

    // --- case C: the flood-fill path ---
    log(`\n--- case C: flood fill ---`);
    const meta = await (await fetch("/fixtures/c_meta.json")).json();
    const photo = await loadImage("/fixtures/c_photo.png");

    const mine = canny(toGrayscale(photo), photo.width, photo.height, meta.low, meta.high);
    const theirs = await loadMask("c_edges");
    let mineOn = 0;
    let theirsOn = 0;
    let both = 0;
    for (let i = 0; i < mine.length; i++) {
      if (mine[i]) mineOn++;
      if (theirs.data[i]) theirsOn++;
      if (mine[i] && theirs.data[i]) both++;
    }
    const overlap = theirsOn ? (both / theirsOn) * 100 : 0;
    log(
      `      Canny edge pixels — OpenCV ${theirsOn}, ported ${mineOn}, ` +
        `${overlap.toFixed(1)}% of OpenCV's edges also found`,
    );
    results.push({ label: "c: canny counts", theirsOn, mineOn, overlap });

    // edgeBarrier and floodSelect deliberately diverge from the Python now: its
    // brightness-derived thresholds left the barrier empty on bright photos. So
    // these are checked for being *usable*, not for matching the original.
    const barrier = edgeBarrier(photo);
    const refBarrier = await loadMask("c_barrier");
    log(
      `      barrier coverage — Python ${(coverage(refBarrier) * 100).toFixed(3)}%, ` +
        `ours ${(coverage(barrier) * 100).toFixed(3)}%`,
    );

    const flood = floodSelect(photo, [{ x: meta.seedX, y: meta.seedY }], 20);
    const floodRef = await loadMask("c_flood_t20");
    const ours = coverage(flood) * 100;
    const theirsPct = coverage(floodRef) * 100;
    log(`      flood coverage — Python ${theirsPct.toFixed(1)}%, ours ${ours.toFixed(1)}%`);

    const bounded = ours > 1 && ours < 85;
    if (!bounded) failures++;
    results.push({ label: "c: flood is bounded", ours, ok: bounded });
    log(
      `${bounded ? "PASS" : "FAIL"}  ${"c: flood stays bounded".padEnd(28)} ` +
        `selected ${ours.toFixed(1)}% (want 1-85%)`,
      bounded ? "pass" : "fail",
    );

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
