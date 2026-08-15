"use client";

/**
 * The ground the interface floats over, and the single source of parallax.
 *
 * One listener writes `--px` and `--py` to the document root, each in the range
 * -1..1, and every moving surface in the stylesheet reads those two properties.
 * Per-element listeners would multiply the same work by the number of panels on
 * screen; this way the cost is one rAF-throttled write per frame regardless of
 * how dense the page is.
 *
 * Input is whichever the device actually has:
 *   · a gyroscope, on a phone or tablet — the interface leans as you tilt it
 *   · the pointer, on anything with one
 *
 * iOS 13 and later require an explicit user gesture before releasing
 * orientation data, so where that permission model exists a small control
 * appears to ask for it. It says what it does and disappears once granted;
 * nothing here begs for a sensor it does not need.
 */

import { useEffect, useSyncExternalStore } from "react";
import Velaris from "@/components/velaris";
import { useTheme } from "@/components/shell";

/** Palettes chosen so the glass reads as tinted, never as decoration. */
const PALETTE = {
  dark: { bg: "#060a12", colors: ["#1d3f80", "#4c2f8f", "#0e5f6e", "#060a12"] },
  light: { bg: "#eef1f7", colors: ["#b9ccf5", "#cdc2f2", "#bfe3ee", "#eef1f7"] },
};

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/**
 * Whether the browser gates orientation data behind a user gesture, as iOS 13
 * and later do, and whether we have stopped asking.
 *
 * Kept outside React and read through `useSyncExternalStore` because it is a
 * browser capability, not application state — setting it from inside an effect
 * would mean an extra render on every mount to discover something that cannot
 * change during the session.
 */
let asked = false;
const askedListeners = new Set<() => void>();

const subscribeAsked = (listener: () => void) => {
  askedListeners.add(listener);
  return () => askedListeners.delete(listener);
};

const gatesOrientation = () =>
  !asked &&
  typeof (
    window.DeviceOrientationEvent as { requestPermission?: unknown } | undefined
  )?.requestPermission === "function";

function stopAsking() {
  asked = true;
  for (const listener of askedListeners) listener();
}

export function Ambient() {
  // Follows the theme attribute rather than holding a copy, so the gradient
  // changes with the toggle and can never disagree with the surface.
  const theme = useTheme();
  const needsMotionPermission = useSyncExternalStore(
    subscribeAsked,
    gatesOrientation,
    () => false,
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    let px = 0;
    let py = 0;
    let queued = false;

    // Writes are batched into one frame: pointermove and deviceorientation both
    // fire faster than the screen refreshes, and a style write per event is how
    // a parallax effect turns into jank.
    const commit = () => {
      queued = false;
      root.style.setProperty("--px", px.toFixed(3));
      root.style.setProperty("--py", py.toFixed(3));
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(commit);
    };

    const onPointer = (event: PointerEvent) => {
      px = clamp((event.clientX / window.innerWidth) * 2 - 1);
      py = clamp((event.clientY / window.innerHeight) * 2 - 1);
      schedule();
    };

    const onOrient = (event: DeviceOrientationEvent) => {
      if (event.gamma === null || event.beta === null) return;
      // gamma is the left-to-right tilt; beta the front-to-back. Beta is offset
      // by 45° so a phone held at a natural reading angle reads as level rather
      // than as permanently tilted forward.
      px = clamp(event.gamma / 45);
      py = clamp((event.beta - 45) / 45);
      schedule();
    };

    window.addEventListener("pointermove", onPointer, { passive: true });

    const orientation = window.DeviceOrientationEvent as
      | (typeof window.DeviceOrientationEvent & {
          requestPermission?: () => Promise<"granted" | "denied">;
        })
      | undefined;

    if (orientation && typeof orientation.requestPermission !== "function") {
      window.addEventListener("deviceorientation", onOrient, { passive: true });
    }

    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onOrient);
      root.style.removeProperty("--px");
      root.style.removeProperty("--py");
    };
  }, []);

  async function enableTilt() {
    const orientation = window.DeviceOrientationEvent as typeof window.DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    try {
      const result = await orientation.requestPermission?.();
      stopAsking();
      // Re-runs the listener setup with permission already granted.
      if (result === "granted") window.location.reload();
    } catch {
      stopAsking();
    }
  }

  const { bg, colors } = PALETTE[theme];

  return (
    <>
      <div className="ambient-field" aria-hidden>
        <Velaris bg={bg} colors={colors} speed={0.5} grain={0.18} height="100%" />
      </div>

      {needsMotionPermission && (
        <button
          type="button"
          onClick={() => void enableTilt()}
          className="glass-thin fixed bottom-4 right-4 z-50 px-3 py-2 text-[11px] font-medium"
          style={{ color: "var(--ink-2)" }}
        >
          Tilt to move the background
        </button>
      )}
    </>
  );
}
