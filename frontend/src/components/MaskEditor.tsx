import { useCallback, useEffect, useRef, useState } from "react";
import type { Mask } from "../lib/maskOps";

export type Tool = "brush" | "erase";

interface Props {
  photo: ImageData;
  /** Current selection. */
  mask: Mask | null;
  tool: Tool;
  brushSize: number;
  /** Changes only when a different photo is loaded; undo survives mask updates. */
  resetKey: string | number;
  onCommit: (mask: Mask) => void;
}

// Full-resolution RGBA snapshots are several MB each, so keep the history short —
// enough to undo a few bad strokes without eating memory.
const UNDO_LIMIT = 6;

export default function MaskEditor({ photo, mask, tool, brushSize, resetKey, onCommit }: Props) {
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const { width, height } = photo;

  useEffect(() => {
    undoStack.current = [];
    setCanUndo(false);
  }, [resetKey]);

  useEffect(() => {
    const canvas = photoCanvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.putImageData(photo, 0, 0);
  }, [photo, width, height]);

  // The selection doubles as both the editable buffer and the visual overlay, so
  // it is drawn as solid red and the stage's opacity does the blending.
  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    if (!mask) return;

    const overlay = new ImageData(width, height);
    for (let p = 0; p < mask.data.length; p++) {
      const i = p * 4;
      overlay.data[i] = 255;
      overlay.data[i + 3] = mask.data[p] ? 255 : 0;
    }
    ctx.putImageData(overlay, 0, 0);
  }, [mask, width, height]);

  const toNatural = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  function pushUndo() {
    const ctx = maskCanvasRef.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    undoStack.current.push(ctx.getImageData(0, 0, width, height));
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setCanUndo(true);
  }

  function strokeTo(x: number, y: number) {
    const ctx = maskCanvasRef.current?.getContext("2d");
    if (!ctx) return;

    // Erasing punches holes in the alpha channel; brushing lays down solid red.
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(255,0,0,1)";
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

  function commit() {
    const ctx = maskCanvasRef.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const painted = ctx.getImageData(0, 0, width, height);
    const next = new Uint8Array(width * height);
    for (let p = 0; p < next.length; p++) next[p] = painted.data[p * 4 + 3] > 127 ? 1 : 0;
    onCommit({ data: next, width, height });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pushUndo();
    drawing.current = true;
    lastPoint.current = null;
    const { x, y } = toNatural(e);
    strokeTo(x, y);
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

  function undo() {
    const ctx = maskCanvasRef.current?.getContext("2d");
    const prev = undoStack.current.pop();
    if (!ctx || !prev) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.putImageData(prev, 0, 0);
    setCanUndo(undoStack.current.length > 0);
    commit();
  }

  return (
    <div className="mask-editor">
      <div className="mask-editor-stage">
        <canvas ref={photoCanvasRef} className="mask-editor-photo" />
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
      </div>
    </div>
  );
}
