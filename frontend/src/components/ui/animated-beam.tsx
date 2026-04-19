import React from 'react';
import { motion } from 'motion/react';

interface AnimatedBeamProps {
    className?: string;
    color?: string;
    duration?: number;
}

export function AnimatedBeam({ className, color = '#2dffb3', duration = 3 }: AnimatedBeamProps) {
    return (
        <div className={`absolute pointer-events-none inset-0 rounded-[inherit] overflow-hidden ${className}`}>
            <motion.div
                className="absolute top-0 left-0 h-[1px] w-1/3 bg-gradient-to-r from-transparent via-current to-transparent"
                style={{ color: color, boxShadow: `0 0 10px ${color}` }}
                animate={{
                    left: ['-50%', '150%']
                }}
                transition={{
                    duration: duration,
                    repeat: Infinity,
                    ease: "linear"
                }}
            />
            <motion.div
                className="absolute bottom-0 right-0 h-[1px] w-1/3 bg-gradient-to-l from-transparent via-current to-transparent"
                style={{ color: color, boxShadow: `0 0 10px ${color}` }}
                animate={{
                    right: ['-50%', '150%']
                }}
                transition={{
                    duration: duration,
                    repeat: Infinity,
                    ease: "linear",
                    delay: duration / 2
                }}
            />
            <motion.div
                className="absolute top-0 left-0 w-[1px] h-1/3 bg-gradient-to-b from-transparent via-current to-transparent"
                style={{ color: color, boxShadow: `0 0 10px ${color}` }}
                animate={{
                    top: ['150%', '-50%']
                }}
                transition={{
                    duration: duration,
                    repeat: Infinity,
                    ease: "linear",
                    delay: duration * 0.75
                }}
            />
            <motion.div
                className="absolute top-0 right-0 w-[1px] h-1/3 bg-gradient-to-b from-transparent via-current to-transparent"
                style={{ color: color, boxShadow: `0 0 10px ${color}` }}
                animate={{
                    top: ['-50%', '150%']
                }}
                transition={{
                    duration: duration,
                    repeat: Infinity,
                    ease: "linear",
                    delay: duration * 0.25
                }}
            />
        </div>
    );
}