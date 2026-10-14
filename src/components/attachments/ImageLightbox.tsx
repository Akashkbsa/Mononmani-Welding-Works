import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { AttachmentInfo } from "../../types/attachment";

interface Props {
  /** The photos of the record, in order. */
  images: AttachmentInfo[];
  /** Which photo opens first. */
  startId: number;
  /** Photos as data: URLs, by file id. */
  urls: Record<number, string>;
  onClose: () => void;
}

const MIN = 0.25;
const MAX = 8;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

/**
 * A photo over the whole window: scroll or use + / - to zoom, drag to move it, double-click to
 * jump between fitted and 2x, arrow keys for the next photo, Esc to close.
 */
export default function ImageLightbox({ images, startId, urls, onClose }: Props) {
  const [index, setIndex] = useState(Math.max(0, images.findIndex((i) => i.id === startId)));
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const image = images[index];

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };
  const go = (step: number) => {
    setIndex((i) => (i + step + images.length) % images.length);
    reset();
  };
  const zoom = (factor: number) => {
    setScale((s) => {
      const next = clamp(s * factor);
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handled = ["Escape", "+", "=", "-", "0", "ArrowLeft", "ArrowRight"];
      if (!handled.includes(e.key)) return;
      // Handled here only, so Escape does not also close the window underneath.
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoom(1.25);
      else if (e.key === "-") zoom(0.8);
      else if (e.key === "0") reset();
      else if (images.length > 1) go(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, onClose]);

  if (!image) return null;
  const btn = "grid h-9 w-9 place-items-center rounded-md text-white/90 hover:bg-white/15 focus-visible:outline-white";

  return (
    <div role="dialog" aria-modal="true" aria-label={image.file_name} className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white">
      <div className="flex items-center justify-between gap-4 px-4 py-2">
        <div className="min-w-0 truncate text-sm">
          {image.file_name}
          {images.length > 1 && <span className="ml-2 text-white/60">{index + 1} of {images.length}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} aria-label="Zoom out" onClick={() => zoom(0.8)}>
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-white/70">{Math.round(scale * 100)}%</span>
          <button type="button" className={btn} aria-label="Zoom in" onClick={() => zoom(1.25)}>
            <ZoomIn className="h-5 w-5" />
          </button>
          <button type="button" className={btn} aria-label="Fit to window" onClick={reset}>
            <Maximize2 className="h-5 w-5" />
          </button>
          <button type="button" className={btn} aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        className={`relative min-h-0 flex-1 select-none overflow-hidden ${scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
        onDoubleClick={() => (scale === 1 ? setScale(2) : reset())}
        onPointerDown={(e) => {
          if (scale <= 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {urls[image.id] ? (
          <img
            src={urls[image.id]}
            alt={image.file_name}
            draggable={false}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: drag.current ? "none" : "transform 120ms ease-out" }}
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-white/70">Loading…</div>
        )}

        {images.length > 1 && (
          <>
            <button type="button" aria-label="Previous photo" className={`${btn} absolute left-3 top-1/2 -translate-y-1/2 bg-black/40`} onClick={() => go(-1)}>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" aria-label="Next photo" className={`${btn} absolute right-3 top-1/2 -translate-y-1/2 bg-black/40`} onClick={() => go(1)}>
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
