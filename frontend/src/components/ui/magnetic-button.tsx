import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { cn } from '@/lib/utils';

import { HTMLMotionProps } from 'framer-motion';

interface MagneticButtonProps extends HTMLMotionProps<"button"> {
    children: React.ReactNode;
    className?: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function MagneticButton({ children, className, onClick, ...props }: MagneticButtonProps) {
    const ref = useRef<HTMLButtonElement>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isClicking, setIsClicking] = useState(false);

    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const springConfig = { stiffness: 150, damping: 15, mass: 0.1 };
    const smoothX = useSpring(mouseX, springConfig);
    const smoothY = useSpring(mouseY, springConfig);

    const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!ref.current) return;
        const { clientX, clientY } = e;
        const { left, top, width, height } = ref.current.getBoundingClientRect();
        const centerX = left + width / 2;
        const centerY = top + height / 2;
        const distanceX = clientX - centerX;
        const distanceY = clientY - centerY;

        mouseX.set(distanceX * 0.3);
        mouseY.set(distanceY * 0.3);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        mouseX.set(0);
        mouseY.set(0);
    };

    const handleMouseEnter = () => {
        setIsHovered(true);
    };

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        setIsClicking(true);
        setTimeout(() => setIsClicking(false), 600);
        if (onClick) onClick(e);
    };

    return (
        <>
            <motion.button
                ref={ref}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onMouseEnter={handleMouseEnter}
                onClick={handleClick}
                style={{
                    x: smoothX,
                    y: smoothY,
                }}
                className={cn(
                    "relative px-4 py-2 bg-white text-black rounded-md font-medium group transition-all duration-300",
                    "hover:shadow-[0_0_20px_rgba(45,255,179,0.3)] animate-pulse-glow",
                    className
                )}
                {...props}
            >
                <div className="absolute inset-0 z-0 p-[1px] rounded-md overflow-hidden bg-white/20">
                    {isHovered && (
                        <div
                            className="absolute inset-[-100%] w-[300%] h-[300%] animate-[spin_2s_linear_infinite]"
                            style={{
                                background: 'conic-gradient(transparent, transparent, transparent, #2dffb3)'
                            }}
                        />
                    )}
                    <div className="absolute inset-[1px] bg-white rounded-[5px] transition-colors" />
                </div>

                <span className="relative z-10 flex items-center justify-center">
                    {children}
                </span>
            </motion.button>

            {isClicking && (
                <motion.div
                    initial={{ translateY: '-100vh', opacity: 0 }}
                    animate={{ translateY: '100vh', opacity: [0, 1, 0] }}
                    transition={{ duration: 0.6, ease: "linear" }}
                    className="fixed inset-0 z-[100] h-[2px] bg-white/30 pointer-events-none"
                />
            )}
        </>
    );
}