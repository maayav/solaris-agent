import React from 'react';
import { cn } from "../../lib/utils";

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'success';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    severity: Severity;
    label?: string;
    className?: string;
}

const severityConfig: Record<Severity, { dot: string; bg: string; text: string }> = {
    critical: { dot: 'bg-red-500', bg: 'bg-red-500/10', text: 'text-red-500' },
    high: { dot: 'bg-orange-500', bg: 'bg-orange-500/10', text: 'text-orange-500' },
    medium: { dot: 'bg-yellow-500', bg: 'bg-yellow-500/10', text: 'text-yellow-500' },
    low: { dot: 'bg-blue-500', bg: 'bg-blue-500/10', text: 'text-blue-500' },
    info: { dot: 'bg-gray-400', bg: 'bg-gray-500/10', text: 'text-gray-400' },
    success: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-500' }
};

export function Badge({ severity, label, className, ...props }: BadgeProps) {
    const config = severityConfig[severity];
    // Auto-capitalize the first letter if no explicit label is provided
    const displayLabel = label || severity.charAt(0).toUpperCase() + severity.slice(1);

    return (
        <div
            className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border border-transparent",
                config.bg,
                config.text,
                className
            )}
            {...props}
        >
            <div className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
            {displayLabel}
        </div>
    );
}
