/**
 * Binary-mask morphology and component analysis.
 *
 * These are ports of the OpenCV calls the Python backend used, kept faithful to
 * their behaviour (including OpenCV's border conventions) so the browser produces
 * the same masks the server did. Masks are one byte per pixel, non-zero = set.
 */

export interface Mask {
  data: Uint8Array;
  width: number;
  height: number;
}

export function emptyMask(width: number, height: number): Mask {
  return { data: new Uint8Array(width * height), width, height };
}

/**
 * Separable square-kernel dilate/erode via per-row running sums.
 *
 * A k x k square is separable into a horizontal then a vertical pass, which turns
 * O(k^2) per pixel into O(1) — the difference between "instant" and "visibly
 * janky" at the 13x13+ kernels a large photo asks for.
 *
 * OpenCV's default border for erode behaves as foreground and for dilate as
 * background; clamping the window to the image reproduces both.
 */
function sweep(src: Uint8Array, width: number, height: number, radius: number, erode: boolean): Uint8Array {
  const pass1 = new Uint8Array(width * height);
  const prefix = new Int32Array(width + 1);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x] + (src[row + x] ? 1 : 0);
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - radius);
      const hi = Math.min(width - 1, x + radius);
      const sum = prefix[hi + 1] - prefix[lo];
      pass1[row + x] = erode ? (sum === hi - lo + 1 ? 1 : 0) : sum > 0 ? 1 : 0;
    }
  }

  const out = new Uint8Array(width * height);
  const col = new Int32Array(height + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y + 1] = col[y] + (pass1[y * width + x] ? 1 : 0);
    for (let y = 0; y < height; y++) {
      const lo = Math.max(0, y - radius);
      const hi = Math.min(height - 1, y + radius);
      const sum = col[hi + 1] - col[lo];
      out[y * width + x] = erode ? (sum === hi - lo + 1 ? 1 : 0) : sum > 0 ? 1 : 0;
    }
  }
  return out;
}

export function dilate(m: Mask, radius: number, iterations = 1): Mask {
  let data = m.data;
  for (let i = 0; i < iterations; i++) data = sweep(data, m.width, m.height, radius, false);
  return { data, width: m.width, height: m.height };
}

export function erode(m: Mask, radius: number, iterations = 1): Mask {
  let data = m.data;
  for (let i = 0; i < iterations; i++) data = sweep(data, m.width, m.height, radius, true);
  return { data, width: m.width, height: m.height };
}

/** Close = dilate then erode: fills small holes. */
export function morphClose(m: Mask, radius: number, iterations = 1): Mask {
  return erode(dilate(m, radius, iterations), radius, iterations);
}

/** Open = erode then dilate: removes small specks. */
export function morphOpen(m: Mask, radius: number, iterations = 1): Mask {
  return dilate(erode(m, radius, iterations), radius, iterations);
}

export interface Components {
  labels: Int32Array; // 0 = background
  areas: number[]; // areas[label], index 0 unused
  count: number; // number of labels including background
}

/** 8-connected labelling, iterative so a full-frame region cannot blow the stack. */
export function connectedComponents(m: Mask): Components {
  const { data, width, height } = m;
  const labels = new Int32Array(width * height);
  const areas: number[] = [0];
  const stack = new Int32Array(width * height);
  let next = 1;

  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start]) continue;

    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    let area = 0;

    while (top > 0) {
      const p = stack[--top];
      area++;
      const px = p % width;
      const py = (p / width) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (!data[q] || labels[q]) continue;
          labels[q] = next;
          stack[top++] = q;
        }
      }
    }
    areas.push(area);
    next++;
  }

  return { labels, areas, count: next };
}

/**
 * Drop specks and close small holes left by per-pixel classification.
 *
 * Radius 2 is a 5x5 kernel, matching the Python this was ported from. A kernel
 * scaled to the image diagonal behaves better on small photos, but that was
 * tried and deliberately reverted, so this keeps the chosen behaviour.
 */
export function refineMask(m: Mask, minAreaRatio = 0.005): Mask {
  const radius = 2;

  let out = morphClose(m, radius, 2);
  out = morphOpen(out, radius, 1);

  const { labels, areas } = connectedComponents(out);
  const minArea = m.width * m.height * minAreaRatio;
  const keep = new Uint8Array(out.data.length);
  for (let i = 0; i < keep.length; i++) {
    const label = labels[i];
    if (label && areas[label] >= minArea) keep[i] = 1;
  }
  return { data: keep, width: m.width, height: m.height };
}

/**
 * Keep only the connected wall regions the user tapped.
 * With no points the whole mask is returned — the zero-click default.
 */
export function selectRegions(m: Mask, points: { x: number; y: number }[]): Mask {
  if (points.length === 0) return m;

  const { labels } = connectedComponents(m);
  const wanted = new Set<number>();
  for (const { x, y } of points) {
    if (x < 0 || x >= m.width || y < 0 || y >= m.height) continue;
    const label = labels[y * m.width + x];
    if (label) wanted.add(label);
  }
  if (wanted.size === 0) {
    throw new Error("No wall was detected where you tapped. Try tapping directly on a wall.");
  }

  const out = new Uint8Array(m.data.length);
  for (let i = 0; i < out.length; i++) if (wanted.has(labels[i])) out[i] = 1;
  return { data: out, width: m.width, height: m.height };
}

export function coverage(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) n++;
  return m.data.length ? n / m.data.length : 0;
}

// --- Edge straightening -----------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/** Moore-neighbour offsets, clockwise starting from west. */
const MOORE: [number, number][] = [
  [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
];

/**
 * Walk the boundary of the region containing (sx, sy), clockwise.
 *
 * Moore-neighbour tracing with Jacob's stopping criterion — terminating on
 * "back at the start heading the same way" rather than merely "back at the
 * start", which would cut a contour short wherever it touches itself.
 */
function traceContour(
  inside: (x: number, y: number) => boolean,
  sx: number,
  sy: number,
): Point[] {
  const contour: Point[] = [{ x: sx, y: sy }];
  let bx = sx;
  let by = sy;
  // Entered from the west: the raster scan guarantees that neighbour is outside.
  let dir = 0;
  let firstStep: { x: number; y: number; dir: number } | null = null;

  // A boundary cannot be longer than the pixel count; the cap is a safety net.
  for (let guard = 0; guard < 1e7; guard++) {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + i) % 8;
      const nx = bx + MOORE[d][0];
      const ny = by + MOORE[d][1];
      if (!inside(nx, ny)) continue;

      // Re-enter the next search from just behind where we came in.
      dir = (d + 6) % 8;
      bx = nx;
      by = ny;
      found = true;
      break;
    }
    if (!found) break; // isolated pixel

    if (firstStep === null) {
      firstStep = { x: bx, y: by, dir };
    } else if (bx === firstStep.x && by === firstStep.y && dir === firstStep.dir) {
      break;
    }
    contour.push({ x: bx, y: by });
  }
  return contour;
}

/** Perpendicular distance from p to the line ab. */
function pointLineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function dpOpen(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointLineDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/**
 * Douglas-Peucker on a closed contour.
 *
 * Splitting at the point farthest from the start before simplifying is what
 * OpenCV's approxPolyDP does for closed curves; running it on the raw sequence
 * instead would anchor both endpoints at the same place and distort that corner.
 */
function simplifyClosed(points: Point[], epsilon: number): Point[] {
  if (points.length < 4) return points.slice();

  let far = 0;
  let best = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  }

  const first = dpOpen(points.slice(0, far + 1), epsilon);
  const second = dpOpen(points.slice(far), epsilon);
  return first.concat(second.slice(1, -1));
}

/** Shoelace area, matching cv2.contourArea. */
function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(sum) / 2;
}

/** Scanline fill of a polygon, even-odd rule. */
function fillPolygon(target: Uint8Array, width: number, height: number, poly: Point[], value: number) {
  if (poly.length < 3) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(height - 1, Math.ceil(maxY));
  const xs: number[] = [];

  for (let y = yStart; y <= yEnd; y++) {
    const scan = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
      const b = poly[i];
      if (a.y === b.y) continue;
      if (scan >= Math.min(a.y, b.y) && scan < Math.max(a.y, b.y)) {
        xs.push(a.x + ((scan - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      const row = y * width;
      for (let x = from; x <= to; x++) target[row + x] = value;
    }
  }
}

/** Background components that never touch the border — i.e. real holes. */
function findHoles(m: Mask): Components {
  const inverted: Mask = { data: new Uint8Array(m.data.length), width: m.width, height: m.height };
  for (let i = 0; i < m.data.length; i++) inverted.data[i] = m.data[i] ? 0 : 1;

  const comps = connectedComponents(inverted);
  const touchesBorder = new Set<number>();
  for (let x = 0; x < m.width; x++) {
    touchesBorder.add(comps.labels[x]);
    touchesBorder.add(comps.labels[(m.height - 1) * m.width + x]);
  }
  for (let y = 0; y < m.height; y++) {
    touchesBorder.add(comps.labels[y * m.width]);
    touchesBorder.add(comps.labels[y * m.width + m.width - 1]);
  }

  for (let i = 0; i < comps.labels.length; i++) {
    if (touchesBorder.has(comps.labels[i])) comps.labels[i] = 0;
  }
  return comps;
}

/**
 * Replace wobbly mask boundaries with straight polygon edges.
 *
 * Per-pixel segmentation upsampled from a coarse grid gives ragged outlines, but
 * real walls meet ceilings, floors and window frames in straight lines.
 * `strength` is a fraction of the image diagonal, so the result is
 * resolution-independent. 0 disables it.
 */
export function straightenMask(m: Mask, strength: number, minAreaRatio = 0.001): Mask {
  if (strength <= 0) return m;

  const { width, height } = m;
  const epsilon = strength * Math.hypot(width, height);
  const minArea = width * height * minAreaRatio;
  const out = new Uint8Array(width * height);

  const outer = connectedComponents(m);
  const holes = findHoles(m);

  // Outers filled first, then holes knocked back out, so ordering cannot let a
  // hole be overwritten by a later outer region.
  const passes: [Components, number][] = [
    [outer, 1],
    [holes, 0],
  ];

  for (const [comps, value] of passes) {
    const seen = new Set<number>();
    for (let i = 0; i < comps.labels.length; i++) {
      const label = comps.labels[i];
      if (!label || seen.has(label)) continue;
      seen.add(label);
      if (comps.areas[label] < minArea) continue;

      const sx = i % width;
      const sy = (i / width) | 0;
      const inside = (x: number, y: number) =>
        x >= 0 && x < width && y >= 0 && y < height && comps.labels[y * width + x] === label;

      const contour = traceContour(inside, sx, sy);
      if (polygonArea(contour) < minArea) continue;
      fillPolygon(out, width, height, simplifyClosed(contour, epsilon), value);
    }
  }

  return { data: out, width, height };
}
