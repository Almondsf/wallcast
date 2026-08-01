/**
 * Image-space operations for the manual ("flood") selection mode.
 *
 * Ports of the OpenCV calls in the Python mask service: a Canny edge map used as
 * a barrier, and a flood fill that spreads from the tapped point but cannot cross
 * that barrier. Without the barrier a fill on a smoothly shaded wall runs away
 * across the whole photo.
 */

import { dilate, type Mask } from "./maskOps";

export function toGrayscale(image: ImageData): Uint8ClampedArray {
  const { data, width, height } = image;
  const gray = new Uint8ClampedArray(width * height);
  for (let p = 0; p < gray.length; p++) {
    const i = p * 4;
    // Rec.601 luma, matching cv2.COLOR_BGR2GRAY.
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

/** Separable 5x5 Gaussian. sigma matches OpenCV's default for ksize=5. */
function gaussianBlur5(src: Uint8ClampedArray, width: number, height: number): Float32Array {
  const sigma = 1.1;
  const k = [0, 1, 2, 3, 4].map((i) => Math.exp(-((i - 2) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  const kernel = k.map((v) => v / sum);

  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let t = -2; t <= 2; t++) {
        const xx = Math.min(width - 1, Math.max(0, x + t));
        acc += src[y * width + xx] * kernel[t + 2];
      }
      tmp[y * width + x] = acc;
    }
  }

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let t = -2; t <= 2; t++) {
        const yy = Math.min(height - 1, Math.max(0, y + t));
        acc += tmp[yy * width + x] * kernel[t + 2];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

interface Gradients {
  magnitude: Float32Array;
  direction: Uint8Array;
}

function gradients(gray: Uint8ClampedArray, width: number, height: number): Gradients {
  const blurred = gaussianBlur5(gray, width, height);
  const magnitude = new Float32Array(width * height);
  const direction = new Uint8Array(width * height); // quantised to 0/45/90/135

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -blurred[i - width - 1] + blurred[i - width + 1] +
        -2 * blurred[i - 1] + 2 * blurred[i + 1] +
        -blurred[i + width - 1] + blurred[i + width + 1];
      const gy =
        -blurred[i - width - 1] - 2 * blurred[i - width] - blurred[i - width + 1] +
        blurred[i + width - 1] + 2 * blurred[i + width] + blurred[i + width + 1];

      // L1, because cv2.Canny defaults to L2gradient=False. This is not cosmetic:
      // L1 runs up to sqrt(2) larger than L2, so using L2 against thresholds tuned
      // for L1 finds far fewer edges and leaves the flood-fill barrier porous
      // enough for a fill to escape across the whole photo.
      magnitude[i] = Math.abs(gx) + Math.abs(gy);

      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      direction[i] = angle < 22.5 || angle >= 157.5 ? 0 : angle < 67.5 ? 1 : angle < 112.5 ? 2 : 3;
    }
  }

  return { magnitude, direction };
}

function edgesFrom(
  { magnitude, direction }: Gradients,
  width: number,
  height: number,
  lowThreshold: number,
  highThreshold: number,
): Uint8Array {
  // Non-maximum suppression: thin ridges to single-pixel lines.
  const thin = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = magnitude[i];
      let a: number;
      let b: number;
      switch (direction[i]) {
        case 0: a = magnitude[i - 1]; b = magnitude[i + 1]; break;
        case 1: a = magnitude[i - width + 1]; b = magnitude[i + width - 1]; break;
        case 2: a = magnitude[i - width]; b = magnitude[i + width]; break;
        default: a = magnitude[i - width - 1]; b = magnitude[i + width + 1];
      }
      thin[i] = m >= a && m >= b ? m : 0;
    }
  }

  // Hysteresis: strong edges seed, weak edges survive only if connected to one.
  const out = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let i = 0; i < thin.length; i++) {
    if (thin[i] >= highThreshold) {
      out[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const n = ny * width + nx;
        if (out[n] || thin[n] < lowThreshold) continue;
        out[n] = 1;
        stack.push(n);
      }
    }
  }
  return out;
}

/** Canny edge detection with explicit thresholds. */
export function canny(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  lowThreshold: number,
  highThreshold: number,
): Uint8Array {
  return edgesFrom(gradients(gray, width, height), width, height, lowThreshold, highThreshold);
}

/** Value below which `fraction` of the samples fall. */
function percentile(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Edge map used to stop a flood fill escaping the wall it started on.
 *
 * Thresholds come from the distribution of gradient magnitudes, not from the
 * image's median *brightness* as the Python original did. That original coupling
 * is why manual mode misbehaved: a bright room has a high median, which pushed
 * the thresholds towards 255, so almost no edges survived and a fill ran away
 * across the whole photo. Measured on three real photos, brightness-derived
 * thresholds produced 0.009%-1.3% edge pixels and selections of 90-100% of the
 * frame; keying off the gradients gives a steady 4-6% and a usable barrier.
 */
export function edgeBarrier(image: ImageData): Mask {
  const { width, height } = image;
  const grads = gradients(toGrayscale(image), width, height);

  // The top ~8% of gradients are the real edges in a room photo: wall meeting
  // ceiling, floor, door frames. Everything below is texture and shading.
  const high = Math.max(12, percentile(grads.magnitude, 0.92));
  const low = high * 0.4;

  const edges = edgesFrom(grads, width, height, low, high);
  // Thicken so a one-pixel gap in an edge does not leak the whole fill through.
  return dilate({ data: edges, width, height }, 1, 2);
}

/**
 * Flood-fill from each tapped point, bounded by the edge barrier.
 *
 * OpenCV's floodFill without FLOODFILL_FIXED_RANGE compares each candidate to
 * the neighbour it is spreading from, not to the seed — a "floating" range that
 * follows gradual shading across a wall. This reproduces that.
 */
export function floodSelect(
  image: ImageData,
  points: { x: number; y: number }[],
  tolerance: number,
): Mask {
  const { width, height, data } = image;
  const barrier = edgeBarrier(image);
  const filled = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);

  for (const { x, y } of points) {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      throw new Error(`Point (${x}, ${y}) is outside the image bounds (${width}x${height})`);
    }
    const start = y * width + x;
    if (barrier.data[start] || filled[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    filled[start] = 1;

    while (head < tail) {
      const p = queue[head++];
      const px = p % width;
      const py = (p / width) | 0;
      const pi = p * 4;

      // 4-connectivity, matching the `4` flag the Python passed.
      const neighbours = [
        px > 0 ? p - 1 : -1,
        px < width - 1 ? p + 1 : -1,
        py > 0 ? p - width : -1,
        py < height - 1 ? p + width : -1,
      ];

      for (const q of neighbours) {
        if (q < 0 || filled[q] || barrier.data[q]) continue;
        const qi = q * 4;
        if (
          Math.abs(data[qi] - data[pi]) <= tolerance &&
          Math.abs(data[qi + 1] - data[pi + 1]) <= tolerance &&
          Math.abs(data[qi + 2] - data[pi + 2]) <= tolerance
        ) {
          filled[q] = 1;
          queue[tail++] = q;
        }
      }
    }
  }

  return { data: filled, width, height };
}
