"use client"

import React, { memo } from "react"
import { cn } from "@/lib/utils"

interface BGPatternProps {
  variant?: "dots" | "grid" | "lines"
  mask?: "none" | "fade-y" | "fade-x" | "radial"
  fill?: string
  className?: string
}

export const BGPattern = memo(({
  variant = "dots",
  mask = "none",
  fill = "rgba(255,255,255,0.3)",
  className = ""
}: BGPatternProps) => {
  
  // Generate pattern SVG based on variant
  const getPatternSvg = () => {
    switch (variant) {
      case "dots":
        return `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='${encodeURIComponent(fill)}' fill-opacity='0.4' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='3'/%3E%3Ccircle cx='13' cy='13' r='3'/%3E%3C/g%3E%3C/svg%3E")`
      case "grid":
        return `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='${encodeURIComponent(fill)}' fill-opacity='0.4' fill-rule='evenodd'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/svg%3E")`
      case "lines":
        return `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='${encodeURIComponent(fill)}' fill-opacity='0.4' fill-rule='evenodd'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/svg%3E")`
      default:
        return "none"
    }
  }

  // Generate mask style based on mask prop
  const getMaskStyle = () => {
    switch (mask) {
      case "fade-y":
        return {
          maskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)"
        }
      case "fade-x":
        return {
          maskImage: "linear-gradient(to right, transparent, black 20%, black 80%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 20%, black 80%, transparent)"
        }
      case "radial":
        return {
          maskImage: "radial-gradient(circle at center, black 40%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(circle at center, black 40%, transparent 80%)"
        }
      default:
        return {}
    }
  }

  return (
    <div 
      className={cn(
        "absolute inset-0 pointer-events-none",
        className
      )}
      style={{
        backgroundImage: getPatternSvg(),
        ...getMaskStyle()
      }}
    />
  )
})

BGPattern.displayName = "BGPattern"
