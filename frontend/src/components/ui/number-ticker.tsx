import React, { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';

interface NumberTickerProps {
    value: number;
    className?: string;
    delay?: number;
}

export function NumberTicker({ value, className, delay = 0 }: NumberTickerProps) {
    const springValue = useSpring(0, {
        stiffness: 100,
        damping: 30,
        mass: 1,
    });

    const display = useTransform(springValue, (current) => Math.round(current));

    useEffect(() => {
        const timeout = setTimeout(() => {
            springValue.set(value);
        }, delay * 1000);

        return () => clearTimeout(timeout);
    }, [value, springValue, delay]);

    return (
        <motion.span className={className}>
            {display}
        </motion.span>
    );
}