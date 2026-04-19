import React from 'react';
import { cn } from "../../lib/utils";

interface ProgressBarProps {
    label: string;
    icon?: React.ReactNode;
    value: number;
    max: number;
    colorClass?: string;
}

export function ProgressBar({ label, icon, value, max, colorClass = "bg-emerald-500" }: ProgressBarProps) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));

    return (
        <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-gray-300">
                    {icon}
                    <span className="font-medium">{label}</span>
                </div>
                <span className="text-gray-500 font-mono">{String(value).padStart(2, '0')}/{String(max).padStart(2, '0')}</span>
            </div>
            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden flex gap-1">
                {/* Segmented bar look inspired by the design */}
                {Array.from({ length: 40 }).map((_, i) => {
                    const isActive = (i / 40) * 100 < percentage;
                    return (
                        <div
                            key={i}
                            className={cn(
                                "h-full flex-1 rounded-sm",
                                isActive ? colorClass : "bg-transparent"
                            )}
                        />
                    )
                })}
            </div>
        </div>
    );
}
