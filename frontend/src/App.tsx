import { useCallback, useEffect, useRef, useState } from "react";
import EditorPage, { type Room } from "./pages/EditorPage";
import UploadPage from "./pages/UploadPage";
import { decodeImage, fromStored, toStored } from "./lib/imaging";
import { loadSegmenter } from "./lib/segmentation";
import { clearRoom, loadRoom, saveRoom } from "./lib/storage";
import "./App.css";

export default function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<number | null>(0);

  // Start fetching the model immediately. It is the slowest part of a first
  // visit, and it can download while the photo is still being chosen.
  useEffect(() => {
    let cancelled = false;
    loadSegmenter()
      .then(() => !cancelled && setModelProgress(null))
      .catch(() => {
        if (!cancelled) {
          setModelProgress(null);
          setError("Wall detection could not load. Manual selection still works.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick up the room from last visit, if there is one.
  useEffect(() => {
    let cancelled = false;
    loadRoom()
      .then((stored) => {
        if (cancelled || !stored) return;
        setRoom({
          photo: fromStored(stored.photo),
          mask: stored.mask
            ? { data: stored.mask, width: stored.photo.width, height: stored.photo.height }
            : null,
          topColorId: stored.topColorId,
          bottomColorId: stored.bottomColorId,
          splitPosition: stored.splitPosition,
          straighten: stored.straighten,
        });
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setBooting(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on a delay: dragging a slider produces a burst of updates and only
  // the last one is worth writing.
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!room) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveRoom({
        photo: toStored(room.photo),
        mask: room.mask ? room.mask.data : null,
        topColorId: room.topColorId,
        bottomColorId: room.bottomColorId,
        splitPosition: room.splitPosition,
        straighten: room.straighten,
        savedAt: Date.now(),
      });
    }, 700);
    return () => window.clearTimeout(saveTimer.current);
  }, [room]);

  const handlePhoto = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const photo = await decodeImage(file);
      setRoom({
        photo,
        mask: null,
        topColorId: null,
        bottomColorId: null,
        splitPosition: 50,
        straighten: 0.004,
      });
    } catch {
      setError("That file could not be read as an image.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStartOver = useCallback(async () => {
    setRoom(null);
    await clearRoom();
  }, []);

  if (booting) return <p className="hint">Loading…</p>;

  if (!room) {
    return (
      <UploadPage
        onPhoto={handlePhoto}
        busy={busy}
        error={error}
        modelProgress={modelProgress}
      />
    );
  }

  return <EditorPage room={room} onChange={setRoom} onStartOver={handleStartOver} />;
}
