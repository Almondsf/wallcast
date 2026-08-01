import { useCallback, useEffect, useRef, useState } from "react";

export type Tool = "brush" | "erase";

interface Props {
  imageUrl: string;
  maskUrl: string | null;
  tool: Tool;
  brushSize: number;
  // Changes only when a different project is opened. The mask URL changes after every
  // stroke (the server returns a straightened version), and undo must survive that.
  resetKey: number;
  onCommit: (maskPngDataUrl: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

// Full-resolution RGBA snapshots are ~5MB each on a large photo, so keep the
// history short — enough to undo a few bad strokes without eating memory.
const UNDO_LIMIT = 6;

export default function MaskEditor({
  imageUrl,
  maskUrl,
  tool,
  brushSize,
  resetKey,
  onCommit,
  onDirtyChange,
}: Props) {
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  // Only a genuinely different project wipes the undo history.
  useEffect(() => {
    undoStack.current = [];
    setCanUndo(false);
  }, [resetKey]);

  // Load the photo purely to learn its natural size. Deliberately NOT crossOrigin:
  // it is only ever shown as an <img>, never drawn into the canvas, and requesting
  // it with CORS here would reuse the non-CORS cache entry left by MaskCanvas and
  // fail the CORS check — which silently left the editor unusable.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      if (cancelled) return;
      setError("Could not load the photo.");
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !size) return;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size.w, size.h);

    // The canvas is sized and paintable now; a missing mask just means starting blank.
    setLoaded(true);
    if (!maskUrl) return;

    let cancelled = false;
    const maskImg = new Image();
    // The mask *is* drawn into the canvas and exported, so it genuinely needs CORS.
    // The cache-buster keeps it from colliding with any non-CORS cache entry.
    maskImg.crossOrigin = "anonymous";
    maskImg.onload = () => {
      if (cancelled) return;
      // The stored mask is white-on-black; convert it to solid red where set so
      // the canvas doubles as both the editable buffer and the visual overlay.
      const tmp = document.createElement("canvas");
      tmp.width = size.w;
      tmp.height = size.h;
      const tctx = tmp.getContext("2d");
      if (!tctx) return;
      tctx.drawImage(maskImg, 0, 0, size.w, size.h);
      const data = tctx.getImageData(0, 0, size.w, size.h);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const on = px[i] > 127;
        px[i] = 255;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = on ? 255 : 0;
      }
      tctx.putImageData(data, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.drawImage(tmp, 0, 0);
      setError(null);
    };
    maskImg.onerror = () => {
      if (cancelled) return;
      setError("Could not load the existing selection — painting will start from blank.");
    };
    maskImg.src = `${maskUrl}${maskUrl.includes("?") ? "&" : "?"}cors=1`;
    return () => {
      cancelled = true;
    };
  }, [maskUrl, size]);

  const toNatural = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  function pushUndo() {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setCanUndo(true);
  }

  function strokeTo(x: number, y: number) {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Erasing punches holes in the alpha channel; brushing lays down solid red.
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(255,0,0,1)";
    ctx.fillStyle = "rgba(255,0,0,1)";
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const from = lastPoint.current ?? { x, y };
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPoint.current = { x, y };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!loaded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pushUndo();
    drawing.current = true;
    lastPoint.current = null;
    const { x, y } = toNatural(e);
    strokeTo(x, y);
    onDirtyChange?.(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const { x, y } = toNatural(e);
    strokeTo(x, y);
  }

  function handlePointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    commit();
  }

  function commit() {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    // Export as white-on-black, which is what the backend stores.
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    if (!octx) return;
    const src = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const dst = octx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const on = src.data[i + 3] > 127 ? 255 : 0;
      dst.data[i] = on;
      dst.data[i + 1] = on;
      dst.data[i + 2] = on;
      dst.data[i + 3] = 255;
    }
    octx.putImageData(dst, 0, 0);
    onCommit(out.toDataURL("image/png"));
    onDirtyChange?.(false);
  }

  function undo() {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const prev = undoStack.current.pop();
    if (!canvas || !ctx || !prev) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.putImageData(prev, 0, 0);
    setCanUndo(undoStack.current.length > 0);
    commit();
  }

  return (
    <div className="mask-editor">
      <div className="mask-editor-stage">
        <img src={imageUrl} alt="" className="mask-editor-photo" />
        <canvas
          ref={maskCanvasRef}
          className="mask-editor-overlay"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
      <div className="tool-row">
        <button type="button" className="link-btn" onClick={undo} disabled={!canUndo}>
          Undo stroke
        </button>
        {!loaded && <span className="hint">Preparing canvas…</span>}
      </div>
      {error && <p className="status error">{error}</p>}
    </div>
  );
}
