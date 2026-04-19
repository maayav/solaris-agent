"use client"

import React, { memo } from "react"
import { motion } from "framer-motion"

const TARGETS = [
  { name: "AMD EPYC", src: "/logos/epyc.svg" },
  { name: "AMD Ryzen AI", src: "/logos/ryzen.svg" },
  { name: "AMD Instinct", src: "/logos/instinct.svg" },
  { name: "Radeon PRO", src: "/logos/radeon.svg" },
  { name: "OWASP Juice Shop", src: "/logos/juiceshop.svg" },
  { name: "DVWA", src: "/logos/dvwa.svg" },
  { name: "NodeGoat", src: "/logos/nodegoat.svg" },
  { name: "WebGoat", src: "/logos/webgoat.svg" }
]

export const TargetMarquee = memo(() => {
  return (
    <div className="w-full py-12 bg-black border-y border-white/5 overflow-hidden relative">
      {/* Fade Mask */}
      <div className="absolute inset-0 z-10 pointer-events-none" 
           style={{ 
             background: 'linear-gradient(to right, black, transparent 15%, transparent 85%, black)',
             maskImage: 'linear-gradient(to right, black, transparent 15%, transparent 85%, black)' 
           }} />
      
      <div className="flex">
        <motion.div
          className="flex whitespace-nowrap will-change-transform"
          animate={{ x: ["0%", "-50%"] }}
          transition={{
            duration: 35, // Balanced speed
            repeat: Infinity,
            ease: "linear",
          }}
        >
          {/* We use 4 sets to ensure even on 4K screens there is no "end" visible before reset */}
          {[0, 1, 2, 3].map((setIdx) => (
            <div key={setIdx} className="flex gap-20 items-center pr-20">
              {TARGETS.map((target, idx) => (
                <div key={`${setIdx}-${idx}`} className="flex items-center gap-3 group cursor-pointer">
                  <img
                    src={target.src}
                    alt={target.name}
                    className="h-8 md:h-10 w-auto grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-300"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      // Fallback if image doesn't exist yet
                      (e.target as HTMLImageElement).style.display = 'none';
                      const span = document.createElement('span');
                      span.innerText = target.name;
                      span.className = "text-zinc-500 text-sm md:text-base font-medium tracking-[0.2em] uppercase whitespace-nowrap";
                      (e.target as HTMLImageElement).parentElement?.appendChild(span);
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  )
})

TargetMarquee.displayName = "TargetMarquee"
