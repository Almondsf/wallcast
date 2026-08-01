/**
 * Wall recolouring on the canvas.
 *
 * Hue and saturation come from the paint chip. Brightness is rescaled so the wall
 * *averages* the paint's own lightness while keeping the room's real shadows —
 * replacing V outright flattens the wall, and leaving it alone renders the wrong
 * colour (a navy on a white wall comes out sky blue).
 */

import type { Mask } from "./maskOps";

export interface Hsv {
  /** 0-360 */
  h: number;
  /** 0-1 */
  s: number;
  /** 0-255, the max-channel definition of V */
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/**
 * Every output pixel in a region shares one hue and saturation and differs only
 * in brightness, so the 256 possible results are precomputed once and the
 * per-pixel loop becomes a table lookup. That is what keeps a full-resolution
 * recolour fast enough to run on every slider move.
 */
function buildRamp(h: number, s: number): Uint8ClampedArray {
  const ramp = new Uint8ClampedArray(256 * 3);
  const hp = (((h % 360) + 360) % 360) / 60;
  const sector = Math.floor(hp) % 6;
  const x01 = 1 - Math.abs((hp % 2) - 1);

  for (let v = 0; v < 256; v++) {
    const v01 = v / 255;
    const c = v01 * s;
    const x = c * x01;
    const m = v01 - c;

    let r = 0;
    let g = 0;
    let b = 0;
    if (sector === 0) [r, g, b] = [c, x, 0];
    else if (sector === 1) [r, g, b] = [x, c, 0];
    else if (sector === 2) [r, g, b] = [0, c, x];
    else if (sector === 3) [r, g, b] = [0, x, c];
    else if (sector === 4) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    ramp[v * 3] = (r + m) * 255;
    ramp[v * 3 + 1] = (g + m) * 255;
    ramp[v * 3 + 2] = (b + m) * 255;
  }
  return ramp;
}

/** Per-pixel brightness, using the max-channel definition of V. */
function valueAt(px: Uint8ClampedArray, i: number): number {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  return r > g ? (r > b ? r : b) : g > b ? g : b;
}

function paintRegion(
  out: Uint8ClampedArray,
  src: Uint8ClampedArray,
  mask: Uint8Array,
  from: number,
  to: number,
  hex: string,
  anchorLuminance: boolean,
): void {
  const { h, s, v } = hexToHsv(hex);
  const ramp = buildRamp(h, s);

  let scale = 1;
  if (anchorLuminance) {
    // Two passes: the region's mean brightness has to be known before any pixel
    // can be rescaled against it.
    let sum = 0;
    let count = 0;
    for (let p = from; p < to; p++) {
      if (!mask[p]) continue;
      sum += valueAt(src, p * 4);
      count++;
    }
    if (count === 0) return;
    const mean = sum / count;
    if (mean <= 1e-6) return;
    scale = v / mean;
  }

  for (let p = from; p < to; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const target = anchorLuminance ? Math.round(valueAt(src, i) * scale) : valueAt(src, i);
    const clamped = target < 0 ? 0 : target > 255 ? 255 : target;
    const r = clamped * 3;
    out[i] = ramp[r];
    out[i + 1] = ramp[r + 1];
    out[i + 2] = ramp[r + 2];
  }
}

export interface RecolorOptions {
  topHex: string;
  /** Set for a two-tone wall; the split runs horizontally. */
  bottomHex?: string | null;
  /** Percentage down the image where the two tones meet. */
  splitPosition?: number | null;
  /** False keeps the photographed brightness exactly as-is. */
  anchorLuminance?: boolean;
}

export function recolor(
  image: ImageData,
  mask: Mask,
  { topHex, bottomHex, splitPosition, anchorLuminance = true }: RecolorOptions,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  const total = image.width * image.height;

  if (bottomHex) {
    const pct = splitPosition ?? 50;
    const splitRow = Math.round(image.height * (pct / 100));
    const boundary = Math.max(0, Math.min(total, splitRow * image.width));
    paintRegion(out.data, image.data, mask.data, 0, boundary, topHex, anchorLuminance);
    paintRegion(out.data, image.data, mask.data, boundary, total, bottomHex, anchorLuminance);
  } else {
    paintRegion(out.data, image.data, mask.data, 0, total, topHex, anchorLuminance);
  }

  return out;
}

/** Translucent tint over the selection, for confirming the mask before painting. */
export function tintPreview(
  image: ImageData,
  mask: Mask,
  rgb: [number, number, number] = [255, 59, 59],
  alpha = 0.45,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  const px = out.data;
  const inv = 1 - alpha;
  for (let p = 0; p < mask.data.length; p++) {
    if (!mask.data[p]) continue;
    const i = p * 4;
    px[i] = rgb[0] * alpha + px[i] * inv;
    px[i + 1] = rgb[1] * alpha + px[i + 1] * inv;
    px[i + 2] = rgb[2] * alpha + px[i + 2] * inv;
  }
  return out;
}
