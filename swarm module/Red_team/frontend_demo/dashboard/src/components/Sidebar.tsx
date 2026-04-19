"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { 
  Plus, 
  MessageSquare, 
  Settings, 
  Shield, 
  History,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface SidebarProps {
  conversations: Array<{
    id: string;
    title: string;
    created_at: Date;
  }>;
  activeConversationId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
}

export function Sidebar({
  conversations,
  activeConversationId,
  onNewConversation,
  onSelectConversation,
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
            <span className="font-semibold text-white">VibeCheck</span>
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

      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onNewConversation}
          className={cn(
            "flex items-center gap-2 w-full p-3 rounded-lg border border-dark-500",
            "hover:bg-dark-600 hover:border-accent-primary/50 transition-all",
            "text-gray-300 hover:text-white"
          )}
        >
          <Plus className="w-5 h-5" />
          {!isCollapsed && <span>New Analysis</span>}
        </button>
      </div>

      {/* Conversations List */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto px-3">
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-gray-500 uppercase tracking-wider">
            <History className="w-3 h-3" />
            <span>Recent</span>
          </div>
          <div className="space-y-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={cn(
                  "flex items-center gap-2 w-full p-2.5 rounded-lg text-left",
                  "hover:bg-dark-600 transition-colors",
                  activeConversationId === conv.id
                    ? "bg-dark-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                )}
              >
                <MessageSquare className="w-4 h-4 flex-shrink-0" />
                <span className="truncate text-sm">{conv.title}</span>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-gray-500 px-2 py-4 text-center">
                No previous analyses
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
