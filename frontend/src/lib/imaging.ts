/** Canvas plumbing: getting pixels in and out of ImageData. */

function contextFor(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get a 2D canvas context");
  return { canvas, ctx };
}

/**
 * Decode a file into ImageData, downscaled so the longest edge is at most
 * `maxEdge`.
 *
 * Phone photos run to 24 megapixels. The segmentation model resizes to 512px
 * internally regardless, and every mask operation is linear in pixel count, so
 * working at full resolution costs a great deal and buys nothing visible.
 */
export async function decodeImage(file: Blob, maxEdge = 1600): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const { ctx } = contextFor(w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    bitmap.close();
  }
}

export function imageDataToCanvas(data: ImageData): HTMLCanvasElement {
  const { canvas, ctx } = contextFor(data.width, data.height);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function imageDataToBlob(data: ImageData, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    imageDataToCanvas(data).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))),
      type,
      quality,
    );
  });
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on a later tick so the click has taken the URL first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Serialise ImageData for IndexedDB — structured clone handles the buffer. */
export interface StoredImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function toStored(image: ImageData): StoredImage {
  return { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
}

export function fromStored(stored: StoredImage): ImageData {
  return new ImageData(new Uint8ClampedArray(stored.data), stored.width, stored.height);
}
