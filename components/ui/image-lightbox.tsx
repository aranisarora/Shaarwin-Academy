"use client";

import { useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";

interface ImageLightboxProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  style?: React.CSSProperties;
  containerClassName?: string;
}

export function ImageLightbox({
  src,
  alt,
  width,
  height,
  className,
  style,
  containerClassName,
}: ImageLightboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={containerClassName}
        onClick={() => setOpen(true)}
        style={{ cursor: "zoom-in" }}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className={className}
          style={style}
        />
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <button
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={src}
              alt={alt}
              width={width}
              height={height}
              className="rounded-xl object-contain max-h-[90vh] max-w-[90vw] w-auto h-auto"
            />
          </div>
        </div>
      )}
    </>
  );
}
