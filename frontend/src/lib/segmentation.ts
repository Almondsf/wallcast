/**
 * Wall segmentation, in the browser.
 *
 * Runs SegFormer (ADE20K) through ONNX Runtime via Transformers.js, so no server
 * is involved and the photo never leaves the device.
 *
 * `Xenova/segformer-b0-finetuned-ade-512-512` is the ONNX conversion of the same
 * checkpoint the Python backend used. Those weights are NVIDIA Source Code
 * License — NON-COMMERCIAL. Swapping to an MIT/Apache model means changing
 * MODEL_ID and nothing else here.
 */

import {
  AutoModelForSemanticSegmentation,
  AutoProcessor,
  RawImage,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";

import type { Mask } from "./maskOps";

export const MODEL_ID = "Xenova/segformer-b0-finetuned-ade-512-512";

// ADE20K class indices. Windows, doors, ceiling and floor are their own classes,
// so they fall out of the wall mask automatically.
const ADE20K_WALL_CLASS = 0;

export type Device = "webgpu" | "wasm";

interface Loaded {
  model: PreTrainedModel;
  processor: Processor;
  device: Device;
}

let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

/** fp32 is ~4x the download of q8; q8 trades a little accuracy for size and speed. */
export type Precision = "fp32" | "q8";

async function tryLoad(device: Device, dtype: Precision) {
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await AutoModelForSemanticSegmentation.from_pretrained(MODEL_ID, {
    device,
    dtype,
  });
  return { model, processor, device };
}

/**
 * Is WebGPU actually usable, not merely present?
 *
 * `'gpu' in navigator` is true in plenty of environments that then fail to return
 * an adapter — headless Chrome and a fair number of mobile browsers among them.
 * Only requesting an adapter tells you the truth.
 */
async function webGPUAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * Load the model once, preferring WebGPU and falling back to WASM.
 *
 * The fallback is not optional: WebGPU is absent or broken on plenty of mobile
 * browsers, which is exactly where this app gets used.
 */
export function loadSegmenter(force?: Device, dtype: Precision = "q8"): Promise<Loaded> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = (async () => {
      if (force !== "wasm" && (force === "webgpu" || (await webGPUAvailable()))) {
        try {
          loaded = await tryLoad("webgpu", dtype);
          return loaded;
        } catch {
          // An adapter that exists but fails to compile the graph is common
          // enough that this must not be fatal.
        }
      }
      loaded = await tryLoad("wasm", dtype);
      return loaded;
    })();
  }
  return loading;
}

/** Bilinear resample matching torch's interpolate(..., align_corners=False). */
function upsample(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  const xScale = sw / dw;
  const yScale = sh / dh;

  for (let dy = 0; dy < dh; dy++) {
    let sy = (dy + 0.5) * yScale - 0.5;
    if (sy < 0) sy = 0;
    const y0 = Math.min(sh - 1, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;

    for (let dx = 0; dx < dw; dx++) {
      let sx = (dx + 0.5) * xScale - 0.5;
      if (sx < 0) sx = 0;
      const x0 = Math.min(sw - 1, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;

      const a = src[y0 * sw + x0];
      const b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0];
      const d = src[y1 * sw + x1];
      out[dy * dw + dx] =
        a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c * (1 - wx) * wy + d * wx * wy;
    }
  }
  return out;
}

export interface SegmentResult {
  mask: Mask;
  device: Device;
  /** Milliseconds spent inside the model, excluding load. */
  inferenceMs: number;
}

/**
 * Return a binary wall mask at the given output size.
 *
 * Only the wall class matters, so the 150 channels are collapsed to a single
 * "wall vs. best alternative" score *before* upsampling. Upsampling all 150
 * channels and then taking argmax costs far more for a result that differs only
 * at boundaries, which refineMask smooths anyway.
 */
export async function segmentWalls(
  image: ImageData,
  outWidth: number,
  outHeight: number,
): Promise<SegmentResult> {
  const { model, processor, device } = await loadSegmenter();

  const raw = new RawImage(new Uint8ClampedArray(image.data), image.width, image.height, 4).rgb();

  const started = performance.now();
  const inputs = await processor(raw);
  const output = await model(inputs);
  const inferenceMs = performance.now() - started;

  const logits = output.logits;
  const [, classes, lh, lw] = logits.dims as number[];
  const data = logits.data as Float32Array;
  const plane = lh * lw;

  // score = wall_logit - max(all other logits), at the model's own resolution.
  const score = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    let best = -Infinity;
    for (let c = 0; c < classes; c++) {
      if (c === ADE20K_WALL_CLASS) continue;
      const v = data[c * plane + i];
      if (v > best) best = v;
    }
    score[i] = data[ADE20K_WALL_CLASS * plane + i] - best;
  }

  const full = upsample(score, lw, lh, outWidth, outHeight);
  const mask = new Uint8Array(outWidth * outHeight);
  for (let i = 0; i < mask.length; i++) mask[i] = full[i] > 0 ? 1 : 0;

  return { mask: { data: mask, width: outWidth, height: outHeight }, device, inferenceMs };
}
