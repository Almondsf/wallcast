import { useEffect, useRef, useState } from "react";
import type { MaskPoint } from "../types";

interface Props {
  imageUrl: string;
  points: MaskPoint[];
  onPointsChange: (points: MaskPoint[]) => void;
}

export default function MaskCanvas({ imageUrl, points, onPointsChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !naturalSize) return;

    canvas.width = naturalSize.w;
    canvas.height = naturalSize.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);
    const radius = Math.max(5, naturalSize.w / 140);
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ff3b3b";
      ctx.fill();
      ctx.lineWidth = Math.max(1, radius / 4);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    });
  }, [naturalSize, points]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !naturalSize) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    const hitRadius = Math.max(8, naturalSize.w / 90);
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
