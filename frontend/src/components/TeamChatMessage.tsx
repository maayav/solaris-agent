import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, CircleDotDashed, CheckCircle2, CircleX } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../lib/utils';

export interface Message {
    id: string;
    team: 'red' | 'blue';
    agent: string;
    content: string;
    timestamp: Date;
    isUser?: boolean;
}

export function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function parseMessage(raw: string): { thinking: string | null; response: string } {
    const thinkingMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const responseMatch = raw.match(/<response>([\s\S]*?)<\/response>/);

    return {
        thinking: thinkingMatch ? thinkingMatch[1].trim() : null,
        response: responseMatch ? responseMatch[1].trim() : raw.trim()
    };
}

interface ThinkingRowProps {
    line: string;
    index: number;
    isLast: boolean;
    isStreaming: boolean;
    isComplete: boolean;
}

function ThinkingRow({ line, index, isLast, isStreaming, isComplete }: ThinkingRowProps) {
    const content = line.replace(/^→\s*/, '');

    let Icon = CheckCircle2;
    let iconColor = '#22c55e';
    let isAnimating = false;

    if (isStreaming && isLast && !isComplete) {
        Icon = CircleDotDashed;
        iconColor = '#3b82f6';
        isAnimating = true;
    } else if (!isLast || isComplete) {
        Icon = CheckCircle2;
        iconColor = '#22c55e';
    }

    return (
        <motion.div
            initial={{ x: -10, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex items-start gap-[10px] relative"
            style={{
                marginBottom: '8px',
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '4px'
            }}
        >
            <div className="relative z-10 flex-shrink-0 mt-0.5">
                <motion.div
                    animate={isAnimating ? { rotate: 360 } : {}}
                    transition={isAnimating ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
                >
                    <Icon className="w-3.5 h-3.5" style={{ color: iconColor, width: '14px', height: '14px' }} />
                </motion.div>
            </div>

            <span
                className="flex-1"
                style={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: '1.6',
                    color: 'rgba(255,255,255,0.85)'
                }}
            >
                {content}
            </span>
        </motion.div>
    );
}

interface ThinkingBlockProps {
    content: string | null;
    isStreaming: boolean;
    isComplete: boolean;
}

function ThinkingBlock({ content, isStreaming, isComplete }: ThinkingBlockProps) {
    const thinkingEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (thinkingEndRef.current) {
            thinkingEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [content]);

    if (!content || content.trim() === '') {
        return null;
    }

    let cleaned = content
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^[-*_]{3,}\s*$/gm, '')
        .replace(/^[\-\*\+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .trim();

    const lines = cleaned.split('\n').filter(line => line.trim().length > 0);

    return (
        <div className="relative pl-1 font-mono" style={{
            maxWidth: '78%',
            padding: '12px 16px',
            borderLeft: '2px solid rgba(220,38,38,0.4)',
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(20px)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            maxHeight: '300px',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            marginBottom: '8px',
            marginLeft: '32px',
            zIndex: 2,
            position: 'relative'
        }}>
            {lines.length > 1 && (
                <div
                    className="absolute left-[0.55rem] top-2 bottom-2 w-px border-l-2 border-dashed"
                    style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                />
            )}

            <AnimatePresence mode="popLayout">
                {lines.map((line, index) => (
                    <ThinkingRow
                        key={`${index}-${line.slice(0, 20)}`}
                        line={line}
                        index={index}
                        isLast={index === lines.length - 1}
                        isStreaming={isStreaming}
                        isComplete={isComplete}
                    />
                ))}
            </AnimatePresence>
            <div ref={thinkingEndRef} />
        </div>
    );
}

export function renderMessageContent(content: string) {
    if (!content) return null;

    const cleanResponse = (text: string) => {
        return text
            .replace(/<response>/g, '')
            .replace(/<\/response>/g, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
            .replace(/<\/thinking>/g, '')
            .trim();
    };

    const cleanedContent = cleanResponse(content);

    return (
        <ReactMarkdown
            components={{
                code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const isInline = !match;

                    if (isInline) {
                        return <code className="bg-white/10 px-1 py-0.5 rounded text-white/80" {...props}>{children}</code>;
                    }

                    return (
                        <div className="mt-2 bg-[#111118] border-y-0 border-r-0 border-l-2 border-white/10 p-3 rounded-r-lg overflow-x-auto font-mono text-[0.72rem] text-white/60 leading-[1.6]">
                            <code {...props} className={className}>
                                {String(children).replace(/\n$/, '')}
                            </code>
                        </div>
                    );
                },
                p({ children, ...props }) {
                    return <p className="mb-2 last:mb-0" {...props}>{children}</p>;
                },
                ul({ children, ...props }) {
                    return <ul className="list-disc pl-4 mb-2" {...props}>{children}</ul>;
                },
                ol({ children, ...props }) {
                    return <ol className="list-decimal pl-4 mb-2" {...props}>{children}</ol>;
                },
                li({ children, ...props }) {
                    return <li className="mb-1" {...props}>{children}</li>;
                },
                strong({ children, ...props }) {
                    return <strong className="font-bold text-white" {...props}>{children}</strong>;
                },
            }}
        >
            {cleanedContent}
        </ReactMarkdown>
    );
}

function getAgentAccentColor(agent: string, team: string): string {
    const lowerAgent = agent.toLowerCase();
    if (lowerAgent.includes('red') || lowerAgent.includes('commander')) return '#EF4444';
    if (lowerAgent.includes('alpha')) return '#F97316';
    if (lowerAgent.includes('beta')) return '#DC2626';
    if (lowerAgent.includes('gamma')) return '#B91C1C';
    if (lowerAgent.includes('blue') || lowerAgent.includes('linter')) return '#06B6D4';
    if (lowerAgent.includes('depcheck')) return '#3B82F6';
    if (lowerAgent.includes('complexity')) return '#0EA5E9';
    if (team === 'blue') return '#06B6D4';
    if (team === 'red') return '#EF4444';
    return '#6b7280';
}

interface TeamChatMessageProps {
    msg: Message;
    streamingMode?: boolean;
    streamingThinking?: string;
    streamingResponse?: string;
    isThinkingOpen?: boolean;
    onToggleThinking?: () => void;
}

export function TeamChatMessage({
    msg,
    streamingMode,
    streamingThinking,
    streamingResponse,
    isThinkingOpen,
    onToggleThinking
}: TeamChatMessageProps) {
    const [isExpanded, setIsExpanded] = useState(!streamingMode);
    const [hasThinkingEnded, setHasThinkingEnded] = useState(false);

    useEffect(() => {
        if (streamingMode && streamingThinking) {
            if (streamingThinking.includes('</thinking>')) {
                setHasThinkingEnded(true);
            }
        } else if (!streamingMode) {
            setHasThinkingEnded(true);
        }
    }, [streamingThinking, streamingMode]);

    useEffect(() => {
        if (streamingMode) {
            setIsExpanded(true);
        }
    }, [streamingMode]);

    useEffect(() => {
        if (isThinkingOpen !== undefined) {
            setIsExpanded(isThinkingOpen);
        }
    }, [isThinkingOpen]);

    const { thinking: thinkingContent, response: responseContent } = React.useMemo(() => {
        if (streamingMode) {
            return {
                thinking: streamingThinking || null,
                response: streamingResponse || ''
            };
        } else {
            return parseMessage(msg.content);
        }
    }, [streamingMode, streamingThinking, streamingResponse, msg.content]);

    const agentColor = msg.isUser ? '#ffffff' : getAgentAccentColor(msg.agent, msg.team);
    const showThinking = streamingMode || (thinkingContent && thinkingContent.length > 0);

    return (
        <div className="flex flex-col">
            <div className="flex items-baseline mb-1">
                <span className="font-['JetBrains_Mono'] font-[500] text-[0.6875rem] tracking-[0.06em] uppercase text-white/50">
                    {msg.isUser ? 'You' : msg.agent}
                </span>
                <span className="font-['JetBrains_Mono'] font-[400] text-[0.625rem] text-white/30 ml-[8px]">
                    {formatTime(msg.timestamp)}
                </span>
            </div>

            <div
                className={cn("border mb-3 backdrop-blur-[20px]",
                    msg.isUser ? "ml-auto text-right" : ""
                )}
                style={{
                    background: msg.isUser
                        ? 'rgba(255,255,255,0.07)'
                        : 'rgba(0,0,0,0.4)',
                    border: msg.isUser ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '16px',
                    padding: msg.isUser ? '10px 16px' : '16px 20px',
                    maxWidth: msg.isUser ? '65%' : '78%',
                    marginRight: msg.isUser ? '32px' : undefined,
                    marginLeft: msg.isUser ? 'auto' : '32px',
                    backdropFilter: msg.isUser ? 'blur(20px)' : 'blur(20px)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    zIndex: 2,
                    position: 'relative'
                }}
            >
                {showThinking && (
                    <div className="mb-2">
                        <button
                            onClick={() => {
                                if (streamingMode && !hasThinkingEnded) return;
                                if (onToggleThinking && streamingMode) onToggleThinking();
                                else setIsExpanded(!isExpanded);
                            }}
                            className={cn(
                                "flex items-center justify-between w-full px-3 py-2 rounded-lg transition-all outline-none",
                                streamingMode && !hasThinkingEnded
                                    ? "cursor-default"
                                    : "hover:bg-white/5 cursor-pointer"
                            )}
                        >
                            <div className="flex items-center gap-2">
                                {streamingMode && !hasThinkingEnded ? (
                                    <span className="flex items-center gap-1 font-mono text-xs text-white/60">
                                        <motion.span
                                            animate={{ opacity: [0.4, 1, 0.4] }}
                                            transition={{ duration: 1, repeat: Infinity }}
                                        >
                                            Thinking
                                        </motion.span>
                                        <span className="flex gap-0.5">
                                            <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:0ms]" />
                                            <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:150ms]" />
                                            <span className="w-1 h-1 rounded-full bg-white/60 animate-bounce [animation-delay:300ms]" />
                                        </span>
                                    </span>
                                ) : (
                                    <span className="font-mono text-xs text-white/50">
                                        Thought for 0s
                                    </span>
                                )}
                            </div>
                            <motion.div
                                animate={{ rotate: isExpanded ? 90 : 0 }}
                                transition={{ duration: 0.2 }}
                            >
                                <ChevronRight className="w-4 h-4 text-white/40" />
                            </motion.div>
                        </button>

                        <AnimatePresence initial={false}>
                            {isExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2, ease: "easeInOut" }}
                                    className="overflow-hidden"
                                >
                                    <div
                                        className="mt-1 border rounded-lg p-3"
                                        style={{
                                            borderColor: 'rgba(255,255,255,0.08)',
                                            backgroundColor: 'rgba(255,255,255,0.03)',
                                        }}
                                    >
                                        <ThinkingBlock
                                            content={streamingMode ? (streamingThinking || '') : (thinkingContent || '')}
                                            isStreaming={streamingMode}
                                            isComplete={hasThinkingEnded}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}

                <div className="text-[0.875rem] text-white/70 leading-[1.6]">
                    {renderMessageContent(responseContent)}
                </div>
            </div>
        </div>
    );
}