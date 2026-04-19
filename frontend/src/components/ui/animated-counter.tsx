"use client"

import React, { useEffect, useRef, memo } from "react"
import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion"

interface AnimatedCounterProps {
  value: number
  duration?: number
  className?: string
}

/**
 * AnimatedCounter Component
 * 
 * Performance: Uses useMotionValue and animate to avoid React re-renders.
 * Scroll Trigger: Starts animation when in view (once).
 * Formatting: One decimal place + % sign.
 */
export const AnimatedCounter = memo(({ 
  value, 
  duration = 1.5, 
  className = "" 
}: AnimatedCounterProps) => {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })
  
  // Motion value to hold the raw number
  const count = useMotionValue(0)
  
  // Transform the motion value into a formatted string
  // This happens outside of React's render cycle for performance
  const rounded = useTransform(count, (latest) => {
    return latest.toFixed(1) + "%"
  })

  useEffect(() => {
    if (isInView) {
      const controls = animate(count, value, {
        duration: duration,
        ease: [0.16, 1, 0.3, 1],
      })
      
      return () => controls.stop()
    }
  }, [isInView, count, value, duration])

  return (
    <motion.span ref={ref} className={`${className} tabular-nums`}>
      {rounded}
    </motion.span>
  )
});

AnimatedCounter.displayName = "AnimatedCounter";
