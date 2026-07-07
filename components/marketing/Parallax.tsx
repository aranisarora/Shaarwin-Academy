"use client";

import { useEffect, useRef } from "react";

/**
 * Subtle hero parallax (P03): the wrapped layer drifts at ~12% of scroll,
 * rAF-throttled, disabled under prefers-reduced-motion. The layer is scaled
 * slightly so the drift never exposes an edge.
 */
export function Parallax({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = Math.min(window.scrollY, window.innerHeight);
        el.style.transform = `translateY(${y * 0.12}px) scale(1.06)`;
      });
    };
    el.style.transform = "scale(1.06)";
    el.style.willChange = "transform";
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      {children}
    </div>
  );
}
