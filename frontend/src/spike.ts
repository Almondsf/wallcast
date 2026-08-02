/**
 * Measurement spike: can SegFormer run in the browser fast enough to replace the
 * server? Times model load, inference and post-processing on a real photo, and
 * draws the resulting wall mask so the quality can be judged too.
 *
 * Results are also written to window.__spike for Playwright to read.
 */

import { coverage, refineMask, type Mask } from "./lib/maskOps";
import { loadSegmenter, MODEL_ID, segmentWalls } from "./lib/segmentation";

const logEl = document.getElementById("log")!;
const canvas = document.getElementById("out") as HTMLCanvasElement;

const lines: string[] = [];
function log(line: string) {
  lines.push(line);
  logEl.textContent = lines.join("\n");
}

declare global {
  interface Window {
    __spike?: Record<string, unknown>;
  }
}

const params = new URLSearchParams(location.search);
const imageUrl = params.get("img") ?? "";
// The model resizes to 512 internally, so feeding it a 24-megapixel photo just
// burns memory. This is the working resolution the mask is produced at.
const maxEdge = Number(params.get("maxEdge") ?? 1024);

async function toImageData(url: string, limit: number) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return { data, natural: { w: bitmap.width, h: bitmap.height } };
}

function draw(image: ImageData, mask: Mask) {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  for (let p = 0; p < mask.data.length; p++) {
    if (!mask.data[p]) continue;
    const i = p * 4;
    out.data[i] = out.data[i] * 0.55 + 255 * 0.45;
    out.data[i + 1] = out.data[i + 1] * 0.55 + 59 * 0.45;
    out.data[i + 2] = out.data[i + 2] * 0.55 + 59 * 0.45;
  }
  ctx.putImageData(out, 0, 0);
}

async function run() {
  const result: Record<string, unknown> = { model: MODEL_ID, ok: false };
  try {
    if (!imageUrl) throw new Error("pass ?img=<url>");

    log(`model:  ${MODEL_ID}`);
    log(`photo:  ${imageUrl}`);

    // Whether threaded WASM is even possible here: ORT needs SharedArrayBuffer,
    // which needs cross-origin isolation, and threads only help if there are cores.
    const iso = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    const sab = typeof SharedArrayBuffer !== "undefined";
    const cores = navigator.hardwareConcurrency ?? 0;
    result.crossOriginIsolated = iso;
    result.sharedArrayBuffer = sab;
    result.cores = cores;
    log(`env:    crossOriginIsolated=${iso}  SharedArrayBuffer=${sab}  cores=${cores}`);

    const t0 = performance.now();
    const { data: image, natural } = await toImageData(imageUrl, maxEdge);
    const decodeMs = performance.now() - t0;
    log(`decode: ${natural.w}x${natural.h} -> ${image.width}x${image.height}  ${decodeMs.toFixed(0)}ms`);
    result.natural = `${natural.w}x${natural.h}`;
    result.working = `${image.width}x${image.height}`;
    result.decodeMs = Math.round(decodeMs);

    log("loading model… (first run downloads weights)");
    const t1 = performance.now();
    const dtype = (params.get("dtype") as "fp32" | "q8" | null) ?? "q8";
    result.dtype = dtype;
    log(`dtype:  ${dtype}`);
    const { device } = await loadSegmenter(dtype);
    const loadMs = performance.now() - t1;
    log(`loaded: device=${device}  ${loadMs.toFixed(0)}ms`);
    result.device = device;
    result.loadMs = Math.round(loadMs);

    const seg = await segmentWalls(image, image.width, image.height);
    log(`infer:  ${seg.inferenceMs.toFixed(0)}ms`);
    result.inferenceMs = Math.round(seg.inferenceMs);

    const t3 = performance.now();
    const refined = refineMask(seg.mask);
    const postMs = performance.now() - t3;
    log(`refine: ${postMs.toFixed(0)}ms`);
    result.postMs = Math.round(postMs);

    result.rawCoverage = Number((coverage(seg.mask) * 100).toFixed(1));
    result.coverage = Number((coverage(refined) * 100).toFixed(1));
    log(`wall:   ${result.rawCoverage}% raw -> ${result.coverage}% after refine`);

    // Second pass: what a returning user experiences, model already in memory.
    const t4 = performance.now();
    await segmentWalls(image, image.width, image.height);
    const warmMs = performance.now() - t4;
    result.warmMs = Math.round(warmMs);
    log(`warm:   ${warmMs.toFixed(0)}ms (model already loaded)`);

    const total = decodeMs + loadMs + seg.inferenceMs + postMs;
    result.coldTotalMs = Math.round(total);
    log(`\nCOLD total (first visit): ${(total / 1000).toFixed(1)}s`);
    log(`WARM total (next photo):  ${((decodeMs + warmMs + postMs) / 1000).toFixed(1)}s`);

    draw(image, refined);
    result.ok = true;
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    log(`\nFAILED — ${msg}`);
    logEl.classList.add("err");
    result.error = msg;
  } finally {
    window.__spike = result;
    document.title = result.ok ? "spike-done" : "spike-failed";
  }
}

run();
