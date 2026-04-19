"use client";

import React from "react";
import { motion } from "framer-motion";

interface Testimonial {
  quote: string;
  author: string;
  role: string;
  avatar?: string;
}

interface TestimonialMarqueeProps {
  items: Testimonial[];
}

export function TestimonialMarquee({ items }: TestimonialMarqueeProps) {
  // Duplicate items for seamless loop
  const duplicatedItems = [...items, ...items];

  return (
    <div className="relative w-full overflow-hidden py-12">
      {/* Gradient Mask for fading edges */}
      <div 
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background: "linear-gradient(to right, black, transparent 15%, transparent 85%, black)",
        }}
      />
      
      <motion.div
        className="flex gap-6 w-max px-6"
        animate={{
          x: ["0%", "-50%"],
        }}
        transition={{
          duration: 30,
          ease: "linear",
          repeat: Infinity,
        }}
        // Pause on hover
        whileHover={{ animationPlayState: "paused" }}
      >
        {duplicatedItems.map((item, idx) => (
          <div
            key={idx}
            className="w-[350px] md:w-[400px] flex-shrink-0 bg-zinc-950/50 border border-white/5 rounded-2xl p-8 flex flex-col gap-6 hover:border-white/10 transition-colors group"
          >
            <p className="text-gray-300 text-base md:text-lg leading-relaxed font-serif italic group-hover:text-white transition-colors">
              "{item.quote}"
            </p>
            <div className="flex items-center gap-4 mt-auto">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-600/20 border border-white/10 flex items-center justify-center overflow-hidden">
                {item.avatar ? (
                  <img src={item.avatar} alt={item.author} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 opacity-50" />
                )}
              </div>
              <div>
                <p className="text-base font-medium text-white">{item.author}</p>
                <p className="text-sm text-gray-500">{item.role}</p>
              </div>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
