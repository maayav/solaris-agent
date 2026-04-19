"use client";

import React, { useEffect, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

export function CustomScrollbar() {
  const { scrollYProgress } = useScroll();
  const [windowHeight, setWindowHeight] = useState(0);

  useEffect(() => {
    const updateHeight = () => setWindowHeight(window.innerHeight);
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // Thumb height is 128px (h-32)
  const thumbHeight = 128;
  const maxTranslate = Math.max(0, windowHeight - thumbHeight);

  // Map scroll progress to y translation
  const y = useTransform(scrollYProgress, [0, 1], [0, maxTranslate]);

  // Opacity for bumpers: 1 only at 0 or 1
  const topBumperOpacity = useTransform(scrollYProgress, (val) => (val <= 0.001 ? 1 : 0));
  const bottomBumperOpacity = useTransform(scrollYProgress, (val) => (val >= 0.999 ? 1 : 0));

  const ScrollIndicator = ({ side }: { side: "left" | "right" }) => (
    <div className={cn(
      "fixed top-0 bottom-0 w-[4px] z-50 pointer-events-none flex justify-center",
      side === "left" ? "left-4" : "right-4"
    )}>
      <motion.div
        style={{ y }}
        className="relative w-[4px] h-32 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)]"
      >
        {/* Top Bumper */}
        <motion.div
          style={{ opacity: topBumperOpacity }}
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[12px] h-[2px] bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)]"
        />

        {/* Bottom Bumper */}
        <motion.div
          style={{ opacity: bottomBumperOpacity }}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[12px] h-[2px] bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)]"
        />
      </motion.div>
    </div>
  );

  return (
    <>
      <ScrollIndicator side="left" />
      <ScrollIndicator side="right" />
    </>
  );
}
