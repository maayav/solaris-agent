import React from 'react';
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    className?: string;
    children?: React.ReactNode;
}

export function Card({ className, style, children, ...props }: CardProps) {
    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-2xl border border-white/[0.08] backdrop-blur-[24px] saturate-[160%] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),_0_32px_64px_rgba(0,0,0,0.4)] transform-gpu will-change-transform",
                className
            )}
            style={{
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                backgroundImage: 'radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255,255,255,0.04), transparent 50%)',
                ...style
            }}
            {...props}
        >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            <div className="absolute inset-0 rounded-2xl pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(45,255,179,0.03),transparent_60%)] mix-blend-screen" />

            <div className="relative z-10 h-full w-full">
                {children}
            </div>
        </div>
    );
}

export default Card;