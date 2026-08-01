import { useCallback, useEffect, useRef, useState } from "react";
import type { MaskMode, MaskPoint, PaintColor, Project } from "../types";
import * as api from "../api";
import ColorPicker from "../components/ColorPicker";
import MaskCanvas from "../components/MaskCanvas";
import MaskEditor, { type Tool } from "../components/MaskEditor";

interface Props {
  projectId: number;
  onBack: () => void;
}

type EditMode = MaskMode | "touchup";

export default function ProjectDetailPage({ projectId, onBack }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [mode, setMode] = useState<EditMode>("auto");
  const [points, setPoints] = useState<MaskPoint[]>([]);
  const [tolerance, setTolerance] = useState(20);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  // Snapshotted when entering touch-up so commits don't reload the canvas mid-edit.
  const [editorMaskUrl, setEditorMaskUrl] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<number | null>(null);
  const [maskReady, setMaskReady] = useState(false);
  const [maskBusy, setMaskBusy] = useState(false);
  const [maskError, setMaskError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(40);
  // Fraction of the image diagonal; 0 leaves the raw wobbly outline alone.
  const [straighten, setStraighten] = useState(0.004);

  const [colors, setColors] = useState<PaintColor[]>([]);
  const [topColorId, setTopColorId] = useState<number | "">("");
  const [bottomColorId, setBottomColorId] = useState<number | "">("");
  const [splitPosition, setSplitPosition] = useState(50);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const maskRequestId = useRef(0);
  const renderRequestId = useRef(0);
  const renderDebounce = useRef<number | undefined>(undefined);

  const applyMaskResult = useCallback((res: { mask_url: string; preview_url: string; coverage: number }) => {
    setPreviewUrl(`${api.resolveUrl(res.preview_url)}?t=${Date.now()}`);
    setMaskUrl(res.mask_url);
    setCoverage(res.coverage);
    setMaskReady(true);
  }, []);

  const runMask = useCallback(
    (nextMode: MaskMode, nextPoints: MaskPoint[], nextTolerance: number, nextStraighten: number) => {
      if (nextMode === "flood" && nextPoints.length === 0) {
        setPreviewUrl(null);
        setMaskReady(false);
        return;
      }

      const id = ++maskRequestId.current;
      setMaskBusy(true);
      setMaskError(null);

      api
        .createMask(projectId, {
          mode: nextMode,
          points: nextPoints,
          tolerance: nextTolerance,
          straighten: nextStraighten,
        })
        .then((res) => {
          if (id !== maskRequestId.current) return;
          applyMaskResult(res);
        })
        .catch((e) => {
          if (id !== maskRequestId.current) return;
          setMaskError(e instanceof Error ? e.message : "Mask generation failed");
        })
        .finally(() => {
          if (id !== maskRequestId.current) return;
          setMaskBusy(false);
        });
    },
    [projectId, applyMaskResult],
  );

  useEffect(() => {
    api.listPaintColors().then(setColors);
  }, []);

  // Detect walls automatically as soon as the project loads — no clicks needed.
  useEffect(() => {
    let cancelled = false;
    api.getProject(projectId).then((p) => {
      if (cancelled) return;
      setProject(p);
      runMask("auto", [], 20, 0.004);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, runMask]);

  function handlePointsChange(next: MaskPoint[]) {
    setPoints(next);
    if (mode !== "touchup") runMask(mode, next, tolerance, straighten);
  }

  function handleModeChange(next: EditMode) {
    setMode(next);
    if (next === "touchup") {
      setEditorMaskUrl(maskUrl ? api.resolveUrl(maskUrl) : null);
      return;
    }
    setPoints([]);
    runMask(next, [], tolerance, straighten);
  }

  function handleToleranceChange(next: number) {
    setTolerance(next);
    if (mode === "flood") runMask("flood", points, next, straighten);
  }

  function handleStraightenChange(next: number) {
    setStraighten(next);
    if (mode !== "touchup") runMask(mode, points, tolerance, next);
  }

  function handleMaskEdited(dataUrl: string) {
    const id = ++maskRequestId.current;
    setMaskBusy(true);
    setMaskError(null);
    api
      .updateMask(projectId, dataUrl, straighten)
      .then((res) => {
        if (id !== maskRequestId.current) return;
        applyMaskResult(res);
        // The server straightened what was painted, so pull the result back into the
        // canvas — otherwise the strokes on screen wouldn't match the saved mask.
        if (straighten > 0) setEditorMaskUrl(api.resolveUrl(res.mask_url));
      })
      .catch((e) => {
        if (id !== maskRequestId.current) return;
        setMaskError(e instanceof Error ? e.message : "Could not save your edit");
      })
      .finally(() => {
        if (id !== maskRequestId.current) return;
        setMaskBusy(false);
      });
  }

  function triggerRender(overrides: { top?: number; bottom?: number | null; split?: number } = {}) {
    const top = overrides.top ?? (topColorId === "" ? null : topColorId);
    const bottom = overrides.bottom !== undefined ? overrides.bottom : bottomColorId === "" ? null : bottomColorId;
    const split = overrides.split ?? splitPosition;
    if (!top || !maskReady) return;

    const id = ++renderRequestId.current;
    setRenderBusy(true);
    setRenderError(null);

    api
      .createRender(projectId, {
        paint_color_top_id: top,
        paint_color_bottom_id: bottom ?? null,
        split_position: bottom ? split : null,
      })
      .then((res) => {
        if (id !== renderRequestId.current) return;
        setRenderUrl(`${api.resolveUrl(res.result_image_url!)}?t=${Date.now()}`);
      })
      .catch((e) => {
        if (id !== renderRequestId.current) return;
        setRenderError(e instanceof Error ? e.message : "Render failed");
      })
      .finally(() => {
        if (id !== renderRequestId.current) return;
        setRenderBusy(false);
      });
  }

  // Re-render whenever the mask itself changes underneath a chosen colour.
  useEffect(() => {
    if (maskReady && topColorId !== "") triggerRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  function handleTopChange(id: number | "") {
    setTopColorId(id);
    if (id !== "") triggerRender({ top: id });
  }

  function handleBottomChange(id: number | "") {
    setBottomColorId(id);
    triggerRender({ bottom: id === "" ? null : id });
  }

  function handleSplitChange(value: number) {
    setSplitPosition(value);
    window.clearTimeout(renderDebounce.current);
    renderDebounce.current = window.setTimeout(() => triggerRender({ split: value }), 150);
  }

  if (!project) return <p className="hint">Loading project…</p>;

  const originalUrl = api.resolveUrl(project.original_image_url);
  const displayImage = previewUrl ?? originalUrl;

  const hints: Record<EditMode, string> = {
    auto: "Walls are detected automatically. Tap one wall to paint only that wall; tap again to deselect.",
    flood: "Tap the wall to spread a selection from that point. Adjust tolerance if it spreads too far.",
    touchup: "Paint over spots the detector missed, or switch to Erase to remove spill. Each stroke saves automatically.",
  };

  return (
    <div className="project-detail">
      <button type="button" className="link-btn" onClick={onBack}>
        &larr; Back to projects
      </button>

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
                disabled={m === "touchup" && !maskReady}
              >
                {m === "auto" ? "Auto-detect" : m === "flood" ? "Manual" : "Touch up"}
              </button>
            ))}
          </div>

          <p className="hint">{hints[mode]}</p>

          <label className="slider-label">
            Straighten edges: {straighten === 0 ? "off" : `${(straighten * 1000).toFixed(0)}`}
            <input
              type="range"
              min={0}
              max={10}
              value={Math.round(straighten * 1000)}
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
                imageUrl={originalUrl}
                maskUrl={editorMaskUrl}
                tool={tool}
                brushSize={brushSize}
                resetKey={projectId}
                onCommit={handleMaskEdited}
              />
            </>
          ) : (
            <>
              <MaskCanvas imageUrl={displayImage} points={points} onPointsChange={handlePointsChange} />
              {mode === "flood" && (
                <label className="slider-label">
                  Tolerance: {tolerance}
                  <input
                    type="range"
                    min={1}
                    max={80}
                    value={tolerance}
                    onChange={(e) => handleToleranceChange(Number(e.target.value))}
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

          {maskBusy && <p className="status">Working…</p>}
          {maskError && <p className="status error">{maskError}</p>}
          {!maskBusy && !maskError && coverage !== null && (
            <p className="hint">{Math.round(coverage * 100)}% of the photo selected as wall</p>
          )}
        </section>

        <section>
          <h2>2. Paint it</h2>
          {!maskReady && <p className="hint">Waiting for a wall selection…</p>}
          <ColorPicker
            label="Top / main color"
            colors={colors}
            value={topColorId}
            onChange={handleTopChange}
            disabled={!maskReady}
            placeholder="Search by name, brand or hex…"
          />

          <ColorPicker
            label="Bottom color (optional, two-tone)"
            colors={colors}
            value={bottomColorId}
            onChange={handleBottomChange}
            disabled={!maskReady || topColorId === ""}
            allowClear
            placeholder="Search, or leave empty for one tone"
          />

          {bottomColorId !== "" && (
            <label className="slider-label">
              Split position: {splitPosition}%
              <input
                type="range"
                min={0}
                max={100}
                value={splitPosition}
                onChange={(e) => handleSplitChange(Number(e.target.value))}
              />
            </label>
          )}

          <div className="render-result">
            {renderUrl ? (
              <div className="render-image-wrap">
                <img src={renderUrl} alt="Rendered result" />
                {bottomColorId !== "" && <div className="split-line" style={{ top: `${splitPosition}%` }} />}
              </div>
            ) : (
              <div className="render-placeholder">Choose a color to see the render</div>
            )}
            {renderBusy && <p className="status">Rendering…</p>}
            {renderError && <p className="status error">{renderError}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
