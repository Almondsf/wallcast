import { useRef, useState } from "react";

interface Props {
  onPhoto: (file: File) => void;
  busy: boolean;
  error: string | null;
  /** Progress of the background model download, 0-1, or null when ready. */
  modelProgress: number | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp";

export default function UploadPage({ onPhoto, busy, error, modelProgress }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(files: FileList | null) {
    const file = files?.[0];
    if (file && !busy) onPhoto(file);
  }

  return (
    <div className="landing">
      <h1>See your room in a new colour</h1>
      <p className="hint">
        Upload a photo of a room. The wall is detected for you, then you can try colours and
        download the result. No account needed, and your photo never leaves your device —
        everything runs in your browser.
      </p>

      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            take(e.target.files);
            e.target.value = ""; // let the same file be picked twice in a row
          }}
        />
        <button
          type="button"
          className="upload-btn"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Working…" : "Choose a photo"}
        </button>
        <p className="hint">or drag one here — JPEG, PNG or WebP</p>
      </div>

      {/* The model downloads while the photo is being chosen, so this is usually
          finished before it is needed. Shown rather than hidden so a slow first
          visit looks like progress instead of a stall. */}
      {modelProgress !== null && (
        <p className="hint">
          Preparing wall detection… {Math.round(modelProgress * 100)}%
          <span className="progress">
            <span style={{ width: `${Math.round(modelProgress * 100)}%` }} />
          </span>
        </p>
      )}

      {error && <p className="status error">{error}</p>}
    </div>
  );
}
