"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Send, Loader2, Target, Shield } from "lucide-react";
import { isValidUrl, extractTargetName } from "@/lib/utils";

interface ChatInputProps {
    onSendMessage: (message: string, isTargetUrl?: boolean) => void;
    isLoading: boolean;
    placeholder?: string;
    disabled?: boolean;
}

export function ChatInput({
    onSendMessage,
    isLoading,
    placeholder = "Enter a target URL to start security assessment...",
    disabled = false,
}: ChatInputProps) {
    const [input, setInput] = useState("");
    const [isUrl, setIsUrl] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(
                textareaRef.current.scrollHeight,
                200
            )}px`;
        }
    }, [input]);

    // Check if input is a valid URL
    useEffect(() => {
        setIsUrl(isValidUrl(input.trim()));
    }, [input]);

    const handleSubmit = () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading || disabled) return;

        onSendMessage(trimmedInput, isUrl);
        setInput("");
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className="border-t border-dark-600 bg-dark-800 p-4">
            <div className="max-w-3xl mx-auto">
                {/* URL indicator */}
                {isUrl && (
                    <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-accent-primary/10 border border-accent-primary/30">
                        <Target className="w-4 h-4 text-accent-primary" />
                        <span className="text-sm text-accent-primary">
                            Target detected: {extractTargetName(input.trim())}
                        </span>
                    </div>
                )}

                {/* Input container */}
                <div className="relative flex items-end gap-2 bg-dark-700 rounded-xl border border-dark-500 focus-within:border-accent-primary/50 transition-colors">
                    <div className="flex-shrink-0 p-3">
                        <Shield className="w-5 h-5 text-gray-500" />
                    </div>

                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        disabled={disabled || isLoading}
                        rows={1}
                        className={cn(
                            "flex-1 resize-none bg-transparent py-3 pr-3 text-white",
                            "placeholder:text-gray-500 focus:outline-none",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    />

                    <button
                        onClick={handleSubmit}
                        disabled={!input.trim() || isLoading || disabled}
                        className={cn(
                            "flex-shrink-0 m-2 p-2 rounded-lg transition-all",
                            "bg-accent-primary hover:bg-accent-hover",
                            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-accent-primary"
                        )}
                    >
                        {isLoading ? (
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                        ) : (
                            <Send className="w-5 h-5 text-white" />
                        )}
                    </button>
                </div>

                {/* Helper text */}
                <p className="mt-2 text-xs text-gray-500 text-center">
                    Press Enter to start mission, Shift+Enter for new line
                </p>
            </div>
        </div>
    );
}
