"use client";

/**
 * A grid that warps toward the pointer and ripples where it is clicked.
 *
 * Adapted from the 21st.dev component to live inside a console rather than to
 * own a landing page:
 *
 * · The canvas is scoped to its container instead of `fixed inset-0`, so it
 *   backs one band of the page and not the entire viewport.
 * · Pointer coordinates are taken relative to that container, which is what
 *   makes the warp follow the cursor once the element is not at the origin.
 * · devicePixelRatio is honoured. The original drew at CSS pixels, which is
 *   visibly soft on every laptop screen made in the last decade.
 * · Colours come from props, so it can be legible on paper as well as at night.
 * · It stops when scrolled out of view or when the tab is hidden, and holds a
 *   single static frame under `prefers-reduced-motion`.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Point {
  x: number;
  y: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  born: number;
}

const CELL_SIZE = 55;
const INFLUENCE_RADIUS = 260;
const MAX_WARP = 24;
const DOT_SPACING = 28;
const LERP_SPEED = 0.08;
const NODE_BASE_RADIUS = 1.8;
const NODE_ACTIVE_RADIUS = 3.2;

export interface KineticGridProps {
  children?: ReactNode;
  className?: string;
  /** Canvas ground. Pass a colour that matches the surface behind it. */
  bg?: string;
  /** `r,g,b` of the resting grid. */
  line?: string;
  /** `r,g,b` of the lines, nodes and ripples near the pointer. */
  active?: string;
  /** Opacity of the resting grid. Lower it when content sits on top. */
  restOpacity?: number;
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

export default function KineticGrid({
  children,
  className,
  bg = "#0b0f17",
  line = "255,255,255",
  active = "74,158,255",
  restOpacity = 0.13,
}: KineticGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const mouse = useRef<Point>({ x: -9999, y: -9999 });
  const target = useRef<Point>({ x: -9999, y: -9999 });
  const ripples = useRef<Ripple[]>([]);
  const raf = useRef(0);
  const size = useRef({ w: 0, h: 0 });

  const warp = useCallback(
    (gx: number, gy: number, col: number, row: number, cols: number, rows: number) => {
      // Pins the boundary rows and columns so the grid does not peel away from
      // its own edges when the pointer approaches them.
      const edge = 1.5;
      const colPin = Math.min(col / edge, (cols - 1 - col) / edge, 1);
      const rowPin = Math.min(row / edge, (rows - 1 - row) / edge, 1);
      const pin = colPin * colPin * rowPin * rowPin;

      const dx = gx - mouse.current.x;
      const dy = gy - mouse.current.y;
      const dist = Math.hypot(dx, dy);
      const proximity = Math.max(0, 1 - dist / INFLUENCE_RADIUS) * pin;

      let rx = 0;
      let ry = 0;
      for (const ripple of ripples.current) {
        const rdist = Math.hypot(gx - ripple.x, gy - ripple.y);
        const width = 55;
        const diff = rdist - ripple.radius;
        if (Math.abs(diff) < width) {
          const strength = (1 - Math.abs(diff) / width) * ripple.opacity * 18 * pin;
          const angle = Math.atan2(gy - ripple.y, gx - ripple.x);
          const sign = diff < 0 ? -1 : 1;
          rx += Math.cos(angle) * strength * sign * -1;
          ry += Math.sin(angle) * strength * sign * -1;
        }
      }

      if (dist < INFLUENCE_RADIUS && dist > 0 && pin > 0) {
        const t = dist / INFLUENCE_RADIUS;
        const eased = t < 0.01 ? 0 : (1 - t) * (1 - t) * Math.min(1, dist / 60);
        const amount = eased * MAX_WARP * pin;
        const angle = Math.atan2(dy, dx);
        return {
          pt: { x: gx - Math.cos(angle) * amount + rx, y: gy - Math.sin(angle) * amount + ry },
          proximity,
        };
      }
      return { pt: { x: gx + rx, y: gy + ry }, proximity };
    },
    [],
  );

  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const { w, h } = size.current;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = `rgba(${line},0.05)`;
      for (let x = DOT_SPACING / 2; x < w; x += DOT_SPACING) {
        for (let y = DOT_SPACING / 2; y < h; y += DOT_SPACING) {
          ctx.beginPath();
          ctx.arc(x, y, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (let i = ripples.current.length - 1; i >= 0; i--) {
        const ripple = ripples.current[i];
        const age = (now - ripple.born) / 1000;
        ripple.radius = Math.max(0, age * 400);
        ripple.opacity = Math.max(0, 1 - age * 1.2);
        if (ripple.opacity <= 0) ripples.current.splice(i, 1);
      }

      const cols = Math.max(2, Math.ceil(w / CELL_SIZE)) + 1;
      const rows = Math.max(2, Math.ceil(h / CELL_SIZE)) + 1;
      const cellW = w / (cols - 1);
      const cellH = h / (rows - 1);

      const pts: Point[][] = [];
      const prox: number[][] = [];
      for (let row = 0; row < rows; row++) {
        pts[row] = [];
        prox[row] = [];
        for (let col = 0; col < cols; col++) {
          const { pt, proximity } = warp(col * cellW, row * cellH, col, row, cols, rows);
          pts[row][col] = pt;
          prox[row][col] = proximity;
        }
      }

      const segment = (p1: Point, p2: Point, a: number, b: number) => {
        const avg = (a + b) / 2;
        const t = avg * avg * (3 - 2 * avg);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle =
          t < 0.01
            ? `rgba(${line},${restOpacity})`
            : `rgba(${active},${lerpN(restOpacity, 0.9, t).toFixed(3)})`;
        ctx.lineWidth = lerpN(0.8, 1.5, t);
        ctx.stroke();
      };

      ctx.lineCap = "butt";
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols - 1; col++)
          segment(pts[row][col], pts[row][col + 1], prox[row][col], prox[row][col + 1]);
      for (let col = 0; col < cols; col++)
        for (let row = 0; row < rows - 1; row++)
          segment(pts[row][col], pts[row + 1][col], prox[row][col], prox[row + 1][col]);

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const p = pts[row][col];
          const t = prox[row][col] * prox[row][col] * (3 - 2 * prox[row][col]);
          const r = lerpN(NODE_BASE_RADIUS, NODE_ACTIVE_RADIUS, t);

          if (t > 0.3) {
            const glow = r + lerpN(0, 6, (t - 0.3) / 0.7);
            const gradient = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, glow);
            gradient.addColorStop(0, `rgba(${active},${(t * 0.3).toFixed(3)})`);
            gradient.addColorStop(1, `rgba(${active},0)`);
            ctx.beginPath();
            ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle =
            t < 0.01 ? `rgba(${line},0.2)` : `rgba(${active},${lerpN(0.2, 1, t).toFixed(3)})`;
          ctx.fill();
        }
      }

      for (const ripple of ripples.current) {
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, Math.max(0, ripple.radius), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${active},${(ripple.opacity * 0.28).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    },
    [active, bg, line, restOpacity, warp],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      // Drawing happens in CSS pixels; the transform does the scaling, which is
      // what keeps the lines crisp on a retina display.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size.current = { w, h };
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      target.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onLeave = () => {
      target.current = { x: -9999, y: -9999 };
    };
    const onClick = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      ripples.current.push({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        radius: 0,
        opacity: 1,
        born: performance.now(),
      });
    };

    const loop = (now: number) => {
      mouse.current.x = lerpN(mouse.current.x, target.current.x, LERP_SPEED);
      mouse.current.y = lerpN(mouse.current.y, target.current.y, LERP_SPEED);
      draw(now);
      raf.current = requestAnimationFrame(loop);
    };

    const start = () => {
      if (!raf.current && !still) raf.current = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };

    // Off-screen or hidden means no work. A console is scrolled; a hero band
    // that keeps animating below the fold is pure heat.
    const visibility = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
      { threshold: 0 },
    );
    visibility.observe(container);

    const onTabVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onTabVisibility);

    container.addEventListener("pointermove", onMove, { passive: true });
    container.addEventListener("pointerleave", onLeave, { passive: true });
    container.addEventListener("pointerdown", onClick, { passive: true });

    if (still) draw(performance.now());
    else start();

    return () => {
      stop();
      visibility.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onTabVisibility);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onClick);
    };
  }, [draw]);

  return (
    <div ref={containerRef} className={cn("relative w-full overflow-hidden", className)}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
