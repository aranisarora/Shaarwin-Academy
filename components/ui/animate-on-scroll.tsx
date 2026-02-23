"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface AnimateOnScrollProps {
  children: ReactNode;
  className?: string;
  /** "up" fades + slides up (default), "fade" fades only */
  variant?: "up" | "fade";
  /** Extra delay in ms, e.g. 100 for stagger */
  delay?: number;
  /** Intersection threshold 0-1, default 0.12 */
  threshold?: number;
}

export function AnimateOnScroll({
  children,
  className = "",
  variant = "up",
  delay = 0,
  threshold = 0.12,
}: AnimateOnScrollProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (delay) el.style.transitionDelay = `${delay}ms`;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("in-view");
          observer.unobserve(el);
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay, threshold]);

  const baseClass = variant === "fade" ? "anim-on-scroll-fade" : "anim-on-scroll";

  return (
    <div ref={ref} className={`${baseClass} ${className}`}>
      {children}
    </div>
  );
}
