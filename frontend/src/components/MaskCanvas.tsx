import { useEffect, useRef } from "react";
import type { MaskPoint } from "../types";

interface Props {
  /** Whatever should be shown underneath the markers: photo, tint, or render. */
  image: ImageData;
  points: MaskPoint[];
  onPointsChange: (points: MaskPoint[]) => void;
}

export default function MaskCanvas({ image, points, onPointsChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.putImageData(image, 0, 0);

    const radius = Math.max(5, image.width / 140);
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ff3b3b";
      ctx.fill();
      ctx.lineWidth = Math.max(1, radius / 4);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    });
  }, [image, points]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);

    const hitRadius = Math.max(8, image.width / 90);
    const hitIndex = points.findIndex((p) => Math.hypot(p.x - x, p.y - y) < hitRadius);
    if (hitIndex >= 0) {
      onPointsChange(points.filter((_, i) => i !== hitIndex));
    } else {
      onPointsChange([...points, { x, y }]);
    }
  }

  return (
    <div className="mask-canvas-wrap">
      <canvas ref={canvasRef} onClick={handleClick} className="mask-canvas" />
    </div>
  );
}
