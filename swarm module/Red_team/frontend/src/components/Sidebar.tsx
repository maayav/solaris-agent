"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
    Plus,
    Target,
    Settings,
    Shield,
    History,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";

interface SidebarProps {
    sessions: Array<{
        id: string;
        title: string;
        target: string;
        created_at: Date;
    }>;
    activeSessionId: string | null;
    onNewSession: () => void;
    onSelectSession: (id: string) => void;
}

export function Sidebar({
    sessions,
    activeSessionId,
    onNewSession,
    onSelectSession,
}: SidebarProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <div
            className={cn(
                "flex flex-col bg-dark-800 border-r border-dark-600 transition-all duration-300",
                isCollapsed ? "w-16" : "w-64"
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-dark-600">
                {!isCollapsed && (
                    <div className="flex items-center gap-2">
                        <Shield className="w-6 h-6 text-accent-primary" />
                        <span className="font-semibold text-white">Red Team</span>
                    </div>
                )}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="p-1.5 rounded-lg hover:bg-dark-600 transition-colors"
                >
                    {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronLeft className="w-4 h-4 text-gray-400" />
                    )}
                </button>
            </div>

            {/* New Mission Button */}
            <div className="p-3">
                <button
                    onClick={onNewSession}
                    className={cn(
                        "flex items-center gap-2 w-full p-3 rounded-lg border border-dark-500",
                        "hover:bg-dark-600 hover:border-accent-primary/50 transition-all",
                        "text-gray-300 hover:text-white"
                    )}
                >
                    <Plus className="w-5 h-5" />
                    {!isCollapsed && <span>New Mission</span>}
                </button>
            </div>

            {/* Sessions List */}
            {!isCollapsed && (
                <div className="flex-1 overflow-y-auto px-3">
                    <div className="flex items-center gap-2 px-2 py-2 text-xs text-gray-500 uppercase tracking-wider">
                        <History className="w-3 h-3" />
                        <span>Recent Missions</span>
                    </div>
                    <div className="space-y-1">
                        {sessions.map((session) => (
                            <button
                                key={session.id}
                                onClick={() => onSelectSession(session.id)}
                                className={cn(
                                    "flex items-center gap-2 w-full p-2.5 rounded-lg text-left",
                                    "hover:bg-dark-600 transition-colors",
                                    activeSessionId === session.id
                                        ? "bg-dark-600 text-white"
                                        : "text-gray-400 hover:text-gray-200"
                                )}
                            >
                                <Target className="w-4 h-4 flex-shrink-0" />
                                <div className="min-w-0">
                                    <p className="truncate text-sm">{session.title}</p>
                                    <p className="truncate text-xs text-gray-500">{session.target}</p>
                                </div>
                            </button>
                        ))}
                        {sessions.length === 0 && (
                            <p className="text-xs text-gray-500 px-2 py-4 text-center">
                                No previous missions
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Footer */}
            {!isCollapsed && (
                <div className="p-3 border-t border-dark-600">
                    <button
                        className={cn(
                            "flex items-center gap-2 w-full p-2.5 rounded-lg",
                            "hover:bg-dark-600 transition-colors text-gray-400 hover:text-gray-200"
                        )}
                    >
                        <Settings className="w-4 h-4" />
                        <span className="text-sm">Settings</span>
                    </button>
                </div>
            )}
        </div>
    );
}
