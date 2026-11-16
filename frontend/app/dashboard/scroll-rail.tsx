"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

export default function DashboardScrollRail() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef(0);
  const [thumbTop, setThumbTop] = useState(0);
  const [thumbHeight, setThumbHeight] = useState(72);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const updateThumb = () => {
      const track = trackRef.current;
      if (!track) return;

      const trackHeight = track.clientHeight;
      const viewportHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const maxScroll = Math.max(0, documentHeight - viewportHeight);

      const nextThumbHeight = maxScroll === 0
        ? trackHeight
        : Math.max(72, (viewportHeight / documentHeight) * trackHeight);
      const maxThumbTop = Math.max(0, trackHeight - nextThumbHeight);
      const scrollRatio = maxScroll === 0 ? 0 : window.scrollY / maxScroll;

      setThumbHeight(nextThumbHeight);
      setThumbTop(scrollRatio * maxThumbTop);
    };

    updateThumb();
    window.addEventListener("scroll", updateThumb, { passive: true });
    window.addEventListener("resize", updateThumb);

    return () => {
      window.removeEventListener("scroll", updateThumb);
      window.removeEventListener("resize", updateThumb);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: MouseEvent) => {
      const track = trackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const trackHeight = rect.height;
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      const nextThumbTop = Math.min(
        maxThumbTop,
        Math.max(0, event.clientY - rect.top - dragOffsetRef.current),
      );

      const documentHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      const maxScroll = Math.max(0, documentHeight - viewportHeight);
      const scrollRatio = maxThumbTop === 0 ? 0 : nextThumbTop / maxThumbTop;

      window.scrollTo({
        top: scrollRatio * maxScroll,
        behavior: "auto",
      });
    };

    const stopDragging = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", stopDragging);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, [dragging, thumbHeight]);

  const startDragging = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const thumbRect = event.currentTarget.getBoundingClientRect();
    dragOffsetRef.current = event.clientY - thumbRect.top;
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  };

  const jumpToPosition = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== trackRef.current) {
      return;
    }

    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const targetThumbTop = event.clientY - rect.top - thumbHeight / 2;
    const maxThumbTop = Math.max(0, rect.height - thumbHeight);
    const clampedThumbTop = Math.min(maxThumbTop, Math.max(0, targetThumbTop));
    const viewportHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const maxScroll = Math.max(0, documentHeight - viewportHeight);
    const scrollRatio = maxThumbTop === 0 ? 0 : clampedThumbTop / maxThumbTop;

    window.scrollTo({
      top: scrollRatio * maxScroll,
      behavior: "smooth",
    });
  };

  return (
    <div className="hidden lg:flex lg:justify-center">
      <div className="sticky top-4 flex h-[calc(100vh-2rem)] items-center">
        <div
          ref={trackRef}
          onMouseDown={jumpToPosition}
          className="dashboard-scroll-track relative h-[86vh] w-3 rounded-full"
        >
          <button
            type="button"
            aria-label="Drag to scroll the dashboard"
            onMouseDown={startDragging}
            className={`dashboard-scroll-thumb absolute left-1/2 w-5 -translate-x-1/2 rounded-full ${dragging ? "dashboard-scroll-thumb-dragging" : ""}`}
            style={{ top: `${thumbTop}px`, height: `${thumbHeight}px` }}
          />
        </div>
      </div>
    </div>
  );
}
