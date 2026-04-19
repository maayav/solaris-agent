"use client"

import React, { useState, useEffect } from "react"
import { motion } from "framer-motion"

interface TypewriterProps {
  text: string
  delay?: number
  speed?: number
  className?: string
}

export function Typewriter({ text, delay = 0, speed = 30, className = "" }: TypewriterProps) {
  const [displayedText, setDisplayedText] = useState("")
  const [start, setStart] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setStart(true)
    }, delay * 1000)

    return () => clearTimeout(timeout)
  }, [delay])

  useEffect(() => {
    if (!start) return

    let i = 0
    const interval = setInterval(() => {
      setDisplayedText(text.slice(0, i))
      i++
      if (i > text.length) {
        clearInterval(interval)
      }
    }, speed)

    return () => clearInterval(interval)
  }, [start, text, speed])

  return (
    <span className={className}>
      {displayedText}
      <motion.span
        animate={{ opacity: [0, 1, 0] }}
        transition={{ repeat: Infinity, duration: 0.8 }}
        className="inline-block w-[2px] h-[1em] bg-current ml-1 align-middle"
      />
    </span>
  )
}
