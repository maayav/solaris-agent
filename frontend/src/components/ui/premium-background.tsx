"use client"

import React from "react"

interface PremiumBackgroundProps {
  children: React.ReactNode
  className?: string
}

export function PremiumBackground({ children, className = "" }: PremiumBackgroundProps) {
  // SVG Grid Pattern as a data URI
  const gridSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Cpath d='M 40 0 L 0 0 0 40' fill='none' stroke='%2318181b' stroke-width='1'/%3E%3C/svg%3E`

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* The Grid Pattern */}
      <div 
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url("${gridSvg}")`,
          maskImage: "radial-gradient(circle at 50% 0%, black, transparent 80%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 0%, black, transparent 80%)",
        }}
      />

      {/* Blurred Accents */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
        {/* Dark Purple Glow */}
        <div 
          className="absolute top-[-10%] left-[20%] w-[40%] h-[40%] rounded-full opacity-20 blur-[100px]"
          style={{ backgroundColor: "#1e1b4b" }}
        />
        {/* Dark Teal Glow */}
        <div 
          className="absolute top-[10%] right-[20%] w-[40%] h-[40%] rounded-full opacity-20 blur-[100px]"
          style={{ backgroundColor: "#064e3b" }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}
