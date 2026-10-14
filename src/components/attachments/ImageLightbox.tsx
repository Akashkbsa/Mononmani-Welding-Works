import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Expand, Minimize, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
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

const MIN = 0.1;
const MAX = 10;
const STEP = 1.25;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

interface View {
  scale: number;
  x: number;
  y: number;
}
const FIT: View = { scale: 1, x: 0, y: 0 };

/**
 * A photo over the whole window, like any photo viewer:
 * - mouse wheel or touchpad pinch zooms towards the pointer, + / - buttons and keys zoom too;
 * - drag to move a zoomed photo, double-click to zoom in or back to fit, 0 or the reset button to fit;
 * - two fingers on a touch screen pinch and drag;
 * - the Full screen button fills the whole screen, arrow keys or buttons go to the next photo, Esc closes.
 * It is drawn on the page itself (not inside the dialog that opened it) so it covers the whole window.
 */
export default function ImageLightbox({ images, startId, urls, onClose }: Props) {
  const [index, setIndex] = useState(Math.max(0, images.findIndex((i) => i.id === startId)));
  const [view, setViewState] = useState<View>(FIT);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The latest view, for the wheel handler and gestures that run outside React's render.
  const viewRef = useRef<View>(FIT);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; view: View; cx: number; cy: number } | null>(null);
  const image = images[index];

  const setView = useCallback((next: View) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  /** Zoom by a factor keeping the point under (px, py), measured from the centre of the stage, still. */
  const zoomAt = useCallback(
    (factor: number, px = 0, py = 0) => {
      const v = viewRef.current;
      const scale = clamp(v.scale * factor);
      if (scale === v.scale) return;
      const ratio = scale / v.scale;
      setView(scale <= 1 ? { scale, x: 0, y: 0 } : { scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio });
    },
    [setView]
  );

  const go = (step: number) => {
    setIndex((i) => (i + step + images.length) % images.length);
    setView(FIT);
  };

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      // Some systems refuse full screen; the viewer already fills the window.
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement === root.current) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // The wheel listener must not be passive, or the browser zooms the whole page on a touchpad pinch.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      // Line-based wheels report small numbers; a pinch (ctrl + wheel) needs a stronger push.
      const unit = e.deltaMode === 1 ? 33 : 1;
      const strength = e.ctrlKey ? 0.01 : 0.0018;
      zoomAt(Math.exp(-e.deltaY * unit * strength), px, py);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handled = ["Escape", "+", "=", "-", "_", "0", "ArrowLeft", "ArrowRight", "f", "F"];
      if (!handled.includes(e.key) || e.ctrlKey || e.metaKey) return;
      // Handled here only, so Escape does not also close the window underneath.
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomAt(STEP);
      else if (e.key === "-" || e.key === "_") zoomAt(1 / STEP);
      else if (e.key === "0") setView(FIT);
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else if (images.length > 1) go(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, onClose, zoomAt, toggleFullscreen]);

  // Nothing behind the viewer should scroll while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    stage.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = stage.current!.getBoundingClientRect();
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: viewRef.current.scale,
        view: viewRef.current,
        cx: (a.x + b.x) / 2 - rect.left - rect.width / 2,
        cy: (a.y + b.y) / 2 - rect.top - rect.height / 2,
      };
    } else if (viewRef.current.scale > 1) {
      setDragging(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const g = gesture.current;
      const scale = clamp(g.scale * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
      const ratio = scale / g.view.scale;
      setView(scale <= 1 ? { scale, x: 0, y: 0 } : { scale, x: g.cx - (g.cx - g.view.x) * ratio, y: g.cy - (g.cy - g.view.y) * ratio });
    } else if (viewRef.current.scale > 1) {
      const v = viewRef.current;
      setView({ ...v, x: v.x + e.clientX - last.x, y: v.y + e.clientY - last.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  if (!image) return null;
  const btn =
    "grid h-10 w-10 place-items-center rounded-md text-white/90 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
  const zoomed = view.scale > 1;

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={image.file_name}
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between gap-4 bg-black/60 px-4 py-2">
        <div className="min-w-0 truncate text-sm">
          {image.file_name}
          {images.length > 1 && (
            <span className="ml-2 text-white/60">
              {index + 1} of {images.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} title="Zoom out (-)" aria-label="Zoom out" onClick={() => zoomAt(1 / STEP)}>
            <ZoomOut className="h-5 w-5" />
          </button>
          <button type="button" className="w-14 rounded-md py-2 text-center text-xs tabular-nums text-white/80 hover:bg-white/15" title="Back to fit (0)" onClick={() => setView(FIT)}>
            {Math.round(view.scale * 100)}%
          </button>
          <button type="button" className={btn} title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomAt(STEP)}>
            <ZoomIn className="h-5 w-5" />
          </button>
          <button type="button" className={btn} title="Fit to window (0)" aria-label="Fit to window" onClick={() => setView(FIT)}>
            <RotateCcw className="h-5 w-5" />
          </button>
          <button
            type="button"
            className={btn}
            title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize className="h-5 w-5" /> : <Expand className="h-5 w-5" />}
          </button>
          <button type="button" className={btn} title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        ref={stage}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${
          zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
        }`}
        onDoubleClick={(e) => {
          const rect = stage.current!.getBoundingClientRect();
          if (viewRef.current.scale > 1) setView(FIT);
          else zoomAt(2.5, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {urls[image.id] ? (
          <img
            src={urls[image.id]}
            alt={image.file_name}
            draggable={false}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: dragging || pointers.current.size > 0 ? "none" : "transform 90ms ease-out",
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-white/70">Loading…</div>
        )}

        {images.length > 1 && (
          <>
            <button type="button" aria-label="Previous photo" className={`${btn} absolute left-3 top-1/2 -translate-y-1/2 bg-black/50`} onClick={() => go(-1)}>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" aria-label="Next photo" className={`${btn} absolute right-3 top-1/2 -translate-y-1/2 bg-black/50`} onClick={() => go(1)}>
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
