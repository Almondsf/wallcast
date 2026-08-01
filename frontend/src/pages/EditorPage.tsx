import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ColorPicker from "../components/ColorPicker";
import MaskCanvas from "../components/MaskCanvas";
import MaskEditor, { type Tool } from "../components/MaskEditor";
import { download, imageDataToBlob } from "../lib/imaging";
import { floodSelect } from "../lib/imageOps";
import { coverage, refineMask, selectRegions, straightenMask, type Mask } from "../lib/maskOps";
import { recolor, tintPreview } from "../lib/recolor";
import { segmentWalls } from "../lib/segmentation";
import { PAINTS, paintById } from "../paints";
import type { EditMode, MaskMode, MaskPoint } from "../types";

export interface Room {
  photo: ImageData;
  mask: Mask | null;
  topColorId: number | null;
  bottomColorId: number | null;
  splitPosition: number;
  straighten: number;
}

interface Props {
  room: Room;
  onChange: (room: Room) => void;
  onStartOver: () => void;
}

const HINTS: Record<EditMode, string> = {
  auto: "Walls are detected automatically. Tap one wall to paint only that wall; tap again to deselect.",
  flood: "Tap the wall to spread a selection from that point. Adjust tolerance if it spreads too far.",
  touchup: "Paint over spots the detector missed, or switch to Erase to remove spill.",
};

export default function EditorPage({ room, onChange, onStartOver }: Props) {
  const { photo } = room;

  const [mode, setMode] = useState<EditMode>("auto");
  const [points, setPoints] = useState<MaskPoint[]>([]);
  const [tolerance, setTolerance] = useState(20);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(40);

  // The full wall mask from the model, kept so tapping a wall only has to
  // re-slice it rather than re-run segmentation.
  const wallMaskRef = useRef<Mask | null>(null);
  const requestId = useRef(0);

  const topHex = paintById(room.topColorId)?.hex ?? null;
  const bottomHex = paintById(room.bottomColorId)?.hex ?? null;

  const update = useCallback(
    (patch: Partial<Room>) => onChange({ ...room, ...patch }),
    [room, onChange],
  );

  const runMask = useCallback(
    async (nextMode: MaskMode, nextPoints: MaskPoint[], nextTolerance: number, nextStraighten: number) => {
      const id = ++requestId.current;
      setError(null);

      try {
        let mask: Mask;
        if (nextMode === "auto") {
          if (!wallMaskRef.current) {
            setBusy("Detecting walls…");
            // Yield so the busy state paints before the main thread is tied up.
            await new Promise((r) => setTimeout(r, 0));
            const seg = await segmentWalls(photo, photo.width, photo.height);
            if (id !== requestId.current) return;
            wallMaskRef.current = refineMask(seg.mask);
          }
          setBusy("Working…");
          const all = wallMaskRef.current;
          if (!coverage(all)) throw new Error("No wall could be detected in this photo. Try Manual mode.");
          mask = selectRegions(all, nextPoints);
        } else {
          if (nextPoints.length === 0) {
            if (id === requestId.current) update({ mask: null });
            return;
          }
          setBusy("Working…");
          await new Promise((r) => setTimeout(r, 0));
          mask = floodSelect(photo, nextPoints, nextTolerance);
        }

        mask = straightenMask(mask, nextStraighten);
        if (id !== requestId.current) return;
        update({ mask });
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof Error ? e.message : "Could not build the wall selection");
      } finally {
        if (id === requestId.current) setBusy(null);
      }
    },
    [photo, update],
  );

  // Detect walls as soon as a photo arrives without a selection.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (room.mask || autoStarted.current) return;
    autoStarted.current = true;
    void runMask("auto", [], 20, room.straighten);
  }, [room.mask, room.straighten, runMask]);

  function handlePointsChange(next: MaskPoint[]) {
    setPoints(next);
    if (mode !== "touchup") void runMask(mode, next, tolerance, room.straighten);
  }

  function handleModeChange(next: EditMode) {
    setMode(next);
    if (next === "touchup") return;
    setPoints([]);
    void runMask(next, [], tolerance, room.straighten);
  }

  function handleStraightenChange(next: number) {
    update({ straighten: next });
    if (mode !== "touchup") void runMask(mode, points, tolerance, next);
  }

  const preview = useMemo(
    () => (room.mask ? tintPreview(photo, room.mask) : photo),
    [photo, room.mask],
  );

  const render = useMemo(() => {
    if (!room.mask || !topHex) return null;
    return recolor(photo, room.mask, {
      topHex,
      bottomHex,
      splitPosition: room.splitPosition,
    });
  }, [photo, room.mask, topHex, bottomHex, room.splitPosition]);

  const cover = useMemo(() => (room.mask ? coverage(room.mask) : null), [room.mask]);

  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = renderCanvasRef.current;
    if (!canvas || !render) return;
    canvas.width = render.width;
    canvas.height = render.height;
    canvas.getContext("2d")?.putImageData(render, 0, 0);
  }, [render]);

  async function handleDownload() {
    if (!render) return;
    const paint = paintById(room.topColorId);
    const name = paint ? `wallcast-${paint.name.toLowerCase().replace(/\s+/g, "-")}.png` : "wallcast.png";
    download(await imageDataToBlob(render), name);
  }

  return (
    <div className="project-detail">
      <div className="page-header">
        <button type="button" className="link-btn" onClick={onStartOver}>
          &larr; Use a different photo
        </button>
      </div>

      <div className="detail-grid">
        <section>
          <h2>1. The wall</h2>

          <div className="mode-toggle">
            {(["auto", "flood", "touchup"] as EditMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? "active" : ""}
                onClick={() => handleModeChange(m)}
                disabled={m === "touchup" && !room.mask}
              >
                {m === "auto" ? "Auto-detect" : m === "flood" ? "Manual" : "Touch up"}
              </button>
            ))}
          </div>

          <p className="hint">{HINTS[mode]}</p>

          <label className="slider-label">
            Straighten edges: {room.straighten === 0 ? "off" : (room.straighten * 1000).toFixed(0)}
            <input
              type="range"
              min={0}
              max={10}
              value={Math.round(room.straighten * 1000)}
              onChange={(e) => handleStraightenChange(Number(e.target.value) / 1000)}
            />
          </label>

          {mode === "touchup" ? (
            <>
              <div className="tool-row">
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={tool === "brush" ? "active" : ""}
                    onClick={() => setTool("brush")}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className={tool === "erase" ? "active" : ""}
                    onClick={() => setTool("erase")}
                  >
                    Erase
                  </button>
                </div>
              </div>
              <label className="slider-label">
                Brush size: {brushSize}px
                <input
                  type="range"
                  min={5}
                  max={200}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                />
              </label>
              <MaskEditor
                photo={photo}
                mask={room.mask}
                tool={tool}
                brushSize={brushSize}
                resetKey={photo.width * photo.height}
                onCommit={(mask) => update({ mask })}
              />
            </>
          ) : (
            <>
              <MaskCanvas image={preview} points={points} onPointsChange={handlePointsChange} />
              {mode === "flood" && (
                <label className="slider-label">
                  Tolerance: {tolerance}
                  <input
                    type="range"
                    min={1}
                    max={80}
                    value={tolerance}
                    onChange={(e) => {
                      setTolerance(Number(e.target.value));
                      void runMask("flood", points, Number(e.target.value), room.straighten);
                    }}
                  />
                </label>
              )}
              {points.length > 0 && (
                <button type="button" className="link-btn" onClick={() => handlePointsChange([])}>
                  Reset to all walls
                </button>
              )}
            </>
          )}

          {busy && <p className="status">{busy}</p>}
          {error && <p className="status error">{error}</p>}
          {!busy && !error && cover !== null && (
            <p className="hint">{Math.round(cover * 100)}% of the photo selected as wall</p>
          )}
        </section>

        <section>
          <h2>2. Paint it</h2>
          {!room.mask && <p className="hint">Waiting for a wall selection…</p>}

          <ColorPicker
            label="Top / main color"
            colors={PAINTS}
            value={room.topColorId}
            onChange={(id) => update({ topColorId: id })}
            disabled={!room.mask}
            placeholder="Search by name, code or hex…"
          />

          <ColorPicker
            label="Bottom color (optional, two-tone)"
            colors={PAINTS}
            value={room.bottomColorId}
            onChange={(id) => update({ bottomColorId: id })}
            disabled={!room.mask || room.topColorId == null}
            allowClear
            placeholder="Search, or leave empty for one tone"
          />

          {room.bottomColorId != null && (
            <label className="slider-label">
              Split position: {room.splitPosition}%
              <input
                type="range"
                min={0}
                max={100}
                value={room.splitPosition}
                onChange={(e) => update({ splitPosition: Number(e.target.value) })}
              />
            </label>
          )}

          <div className="render-result">
            {render ? (
              <>
                <div className="render-image-wrap">
                  <canvas ref={renderCanvasRef} />
                  {room.bottomColorId != null && (
                    <div className="split-line" style={{ top: `${room.splitPosition}%` }} />
                  )}
                </div>
                <div className="tool-row">
                  <button type="button" className="upload-btn" onClick={handleDownload}>
                    Download image
                  </button>
                </div>
              </>
            ) : (
              <div className="render-placeholder">Choose a color to see the render</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
